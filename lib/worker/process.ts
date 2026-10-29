import "server-only";
import { runDebrief } from "../candidate-debrief";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRecording, meetingParticipants, parseTracks, type DailyTrack } from "../daily";
import { findInviteById } from "../repo";
import { listNotes } from "../staff/repo";
import { noteLine, parseCallName } from "../stages";
import { supabaseAdmin } from "../supabase/admin";
import { compressForSpeech, downloadTrack } from "./audio";
import { formatOffset } from "./format";
import { SUMMARY_MODEL, summariseInterview, summaryConfigured } from "./summarise";
import { STT_MODEL, STT_PROVIDER, translateToEnglish, translationCostUsd } from "./translate";

// The transcription pipeline for one Daily raw-tracks recording:
//   download each participant's audio track from S3 -> compress (ffmpeg) ->
//   translate to English (Groq Whisper) -> store segments labelled recruiter /
//   candidate on one timeline -> summarise (Claude) -> done.
// Re-running is safe: each step replaces what an earlier attempt stored.

type Role = "recruiter" | "candidate";

// Raw-tracks keys look like .../<recording start ms>-<participant id>-cam-audio-<track start ms>
const TRACK_KEY = /(\d{13})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-cam-audio-(\d{13})/i;

export function isAudioTrack(track: DailyTrack): boolean {
  return track.type === "audio" || (track.type === null && /audio/i.test(track.s3Key));
}

export function trackTiming(s3Key: string, recordingStartMs: number | null): { participantId: string | null; offsetMs: number } {
  const match = TRACK_KEY.exec(s3Key);
  if (!match) return { participantId: null, offsetMs: 0 };
  const start = recordingStartMs ?? Number(match[1]);
  return { participantId: match[2].toLowerCase(), offsetMs: Math.max(0, Number(match[3]) - start) };
}

const db = () => supabaseAdmin();

async function setStatus(recordingId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db().from("cos_recruitment_recordings").update({ status, ...extra }).eq("id", recordingId);
  if (error) throw new Error(`Recording status update failed: ${error.message}`);
}

// Called from the Daily webhook: records the finished recording and its tracks
// against the booking whose room it was. Returns the recording row id.
export async function registerReadyRecording(payload: {
  recording_id?: string;
  room_name?: string;
  start_ts?: number;
  duration?: number;
  tracks?: unknown;
}): Promise<string | null> {
  if (!payload.recording_id || !payload.room_name) return null;
  const booking = await db().from("cos_recruitment_bookings").select("id").eq("daily_room_name", payload.room_name).maybeSingle();
  if (booking.error) throw new Error(`Booking lookup failed: ${booking.error.message}`);
  if (!booking.data) return null; // not one of ours

  const { data, error } = await db()
    .from("cos_recruitment_recordings")
    .upsert(
      {
        booking_id: booking.data.id,
        daily_recording_id: payload.recording_id,
        started_at: payload.start_ts ? new Date(payload.start_ts * 1000).toISOString() : undefined,
        duration_secs: typeof payload.duration === "number" ? Math.round(payload.duration) : undefined,
        daily_tracks: parseTracks(payload.tracks),
      },
      { onConflict: "daily_recording_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`Saving recording failed: ${error.message}`);
  return data.id;
}

export async function processRecording(recordingId: string): Promise<void> {
  const claim = await db().rpc("cos_recruitment_claim_recording", { p_recording_id: recordingId });
  if (claim.error) throw new Error(`Claiming recording failed: ${claim.error.message}`);
  if (!claim.data) return; // done, running elsewhere, or out of attempts

  const work = await mkdtemp(join(tmpdir(), "cosrec-"));
  try {
    await runPipeline(recordingId, work);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[worker] recording failed", recordingId, message);
    await setStatus(recordingId, "failed", { error: message.slice(0, 2000) });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function runPipeline(recordingId: string, work: string): Promise<void> {
  const rec = await db()
    .from("cos_recruitment_recordings")
    .select("id, booking_id, daily_recording_id, started_at, daily_tracks")
    .eq("id", recordingId)
    .single();
  if (rec.error) throw new Error(`Recording lookup failed: ${rec.error.message}`);
  const booking = await findInviteById(rec.data.booking_id);
  if (!booking) throw new Error("Booking for this recording no longer exists.");

  // Tracks from the webhook, topped up from Daily's API; plus who was who.
  const daily = rec.data.daily_recording_id ? await getRecording(rec.data.daily_recording_id) : null;
  const known = parseTracks(rec.data.daily_tracks);
  const tracks = (known.length ? known : (daily?.tracks ?? [])).filter(isAudioTrack);
  if (tracks.length === 0) throw new Error("No audio tracks on this recording yet.");

  const recruiterIds = new Set<string>();
  // Extra attendees join as "<name> (client)" / "<name> (other)". Their audio
  // isn't transcribed: the transcript is the recruiter and the candidate.
  const guestIds = new Set<string>();
  if (daily?.mtgSessionId) {
    for (const p of await meetingParticipants(daily.mtgSessionId)) {
      if (p.userId?.startsWith("recruiter:")) recruiterIds.add(p.participantId.toLowerCase());
      else if (parseCallName(p.userName).role) guestIds.add(p.participantId.toLowerCase());
    }
  }
  const startMs = rec.data.started_at ? new Date(rec.data.started_at).getTime() : daily?.startTs ? daily.startTs * 1000 : null;

  // 1. Download, compress, translate each track.
  let longest = 0;
  for (const [i, track] of tracks.entries()) {
    const { participantId, offsetMs } = trackTiming(track.s3Key, startMs);
    if (participantId && guestIds.has(participantId)) continue;
    // Anyone else who isn't the recruiter is the candidate.
    const role: Role = participantId && recruiterIds.has(participantId) ? "recruiter" : "candidate";

    const raw = join(work, `track-${i}.webm`);
    const small = join(work, `track-${i}.ogg`);
    await downloadTrack(track.s3Key, raw);
    const seconds = await compressForSpeech(raw, small);
    longest = Math.max(longest, offsetMs / 1000 + seconds);

    await setStatus(recordingId, "translating");
    const segments = await translateToEnglish(small);

    const saved = await db()
      .from("cos_recruitment_recording_tracks")
      .upsert(
        {
          recording_id: recordingId,
          participant_role: role,
          daily_participant_id: participantId,
          s3_key: track.s3Key,
          track_offset_ms: offsetMs,
          duration_secs: Math.round(seconds),
          stt_provider: STT_PROVIDER,
          stt_model: STT_MODEL,
          cost_usd: translationCostUsd(seconds),
        },
        { onConflict: "s3_key" },
      )
      .select("id")
      .single();
    if (saved.error) throw new Error(`Saving track failed: ${saved.error.message}`);

    const cleared = await db().from("cos_recruitment_transcript_segments").delete().eq("track_id", saved.data.id);
    if (cleared.error) throw new Error(`Clearing old segments failed: ${cleared.error.message}`);
    if (segments.length) {
      const inserted = await db()
        .from("cos_recruitment_transcript_segments")
        .insert(
          segments.map((s) => ({
            recording_id: recordingId,
            track_id: saved.data.id,
            speaker_role: role,
            start_ms: s.startMs + offsetMs,
            end_ms: s.endMs + offsetMs,
            text_en: s.text,
          })),
        );
      if (inserted.error) throw new Error(`Saving transcript failed: ${inserted.error.message}`);
    }
  }

  // 2. Summary, from the merged timeline plus the recruiter's notes.
  if (summaryConfigured()) {
    await setStatus(recordingId, "summarising");
    const segs = await db()
      .from("cos_recruitment_transcript_segments")
      .select("speaker_role, start_ms, text_en")
      .eq("recording_id", recordingId)
      .order("start_ms");
    if (segs.error) throw new Error(`Loading transcript failed: ${segs.error.message}`);
    const transcript = (segs.data ?? [])
      .map((s) => `[${formatOffset(s.start_ms)}] ${s.speaker_role === "recruiter" ? "Recruiter" : "Candidate"}: ${s.text_en}`)
      .join("\n");
    if (transcript) {
      const notes = (await listNotes(booking.bookingId)).map((n) =>
        noteLine("", n).trim(),
      );
      const result = await summariseInterview({
        jobTitle: booking.interview.jobTitle,
        clientName: booking.interview.clientName,
        candidateName: booking.candidateName,
        transcript,
        notes,
      });
      await db().from("cos_recruitment_summaries").delete().eq("recording_id", recordingId);
      const saved = await db()
        .from("cos_recruitment_summaries")
        .insert({ recording_id: recordingId, model: SUMMARY_MODEL, summary: result.summary, scores: result });
      if (saved.error) throw new Error(`Saving summary failed: ${saved.error.message}`);
      // The candidate overview after the interview (best-effort; it records
      // its own failure and can be regenerated from the overview page).
      await runDebrief(booking, transcript);
    }
  }

  await setStatus(recordingId, "done", {
    completed_at: new Date().toISOString(),
    duration_secs: Math.round(daily?.duration ?? longest),
  });
}

// Retries anything waiting (webhook processing failed, server restarted).
export async function processDueRecordings(limit = 5): Promise<number> {
  const due = await db().rpc("cos_recruitment_recordings_due", { p_limit: limit });
  if (due.error) throw new Error(`Listing recordings failed: ${due.error.message}`);
  const ids = (due.data ?? []) as string[];
  for (const id of ids) await processRecording(id);
  return ids.length;
}
