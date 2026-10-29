import "server-only";
import { demoMode } from "../demo";
import { supabaseAdmin } from "../supabase/admin";
import type { InterviewSummary } from "../worker/summarise";

// The finished interview for the recruiter: processing status, the merged
// English transcript, and the summary.

export type TranscriptLine = { speaker: "recruiter" | "candidate"; startMs: number; text: string };

export type InterviewRecord = {
  recordingId: string | null;
  status: "none" | "pending" | "downloading" | "translating" | "summarising" | "done" | "failed";
  error: string | null;
  durationSecs: number | null;
  lines: TranscriptLine[];
  summary: (InterviewSummary & { model: string | null; writtenToJobAdderAt: string | null }) | null;
};

const EMPTY: InterviewRecord = { recordingId: null, status: "none", error: null, durationSecs: null, lines: [], summary: null };

export async function getInterviewRecord(bookingId: string): Promise<InterviewRecord> {
  if (demoMode()) return demoRecord();
  const db = supabaseAdmin();
  const rec = await db
    .from("cos_recruitment_recordings")
    .select("id, status, error, duration_secs")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rec.error) throw new Error(`Recording lookup failed: ${rec.error.message}`);
  if (!rec.data) return EMPTY;

  const [segs, sum] = await Promise.all([
    db.from("cos_recruitment_transcript_segments").select("speaker_role, start_ms, text_en").eq("recording_id", rec.data.id).order("start_ms"),
    db
      .from("cos_recruitment_summaries")
      .select("model, scores, written_to_jobadder_at")
      .eq("recording_id", rec.data.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (segs.error) throw new Error(`Transcript lookup failed: ${segs.error.message}`);
  if (sum.error) throw new Error(`Summary lookup failed: ${sum.error.message}`);

  return {
    recordingId: rec.data.id,
    status: rec.data.status,
    error: rec.data.error,
    durationSecs: rec.data.duration_secs,
    lines: (segs.data ?? []).map((s) => ({ speaker: s.speaker_role, startMs: s.start_ms, text: s.text_en })),
    summary: sum.data
      ? { ...(sum.data.scores as InterviewSummary), model: sum.data.model, writtenToJobAdderAt: sum.data.written_to_jobadder_at }
      : null,
  };
}

export async function markSummaryWritten(recordingId: string): Promise<void> {
  if (demoMode()) {
    if (demo.summary) demo.summary.writtenToJobAdderAt = new Date().toISOString();
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_summaries")
    .update({ written_to_jobadder_at: new Date().toISOString() })
    .eq("recording_id", recordingId);
  if (error) throw new Error(`Updating summary failed: ${error.message}`);
}

// --- Local demo ---------------------------------------------------------------

const demo: InterviewRecord = {
  recordingId: "demo-recording",
  status: "done",
  error: null,
  durationSecs: 1460,
  lines: [
    { speaker: "recruiter", startMs: 4000, text: "Hi Maria, thanks for joining. Can you hear me okay?" },
    { speaker: "candidate", startMs: 8500, text: "Yes, I can hear you clearly. Thank you for the opportunity." },
    { speaker: "recruiter", startMs: 14000, text: "Great. Tell me a little about your current role." },
    { speaker: "candidate", startMs: 19000, text: "I've been a customer support agent at a BPO in Pasig for three years, handling chat and email for an Australian telco." },
    { speaker: "recruiter", startMs: 41000, text: "What does a typical difficult call look like for you?" },
    { speaker: "candidate", startMs: 46000, text: "Usually billing disputes. I listen first, confirm the account details, then explain the charges step by step before offering options." },
    { speaker: "recruiter", startMs: 70000, text: "Are you comfortable working Sydney business hours?" },
    { speaker: "candidate", startMs: 74000, text: "Yes, I'm used to the early shift. I live close to the office too, so hybrid is fine." },
  ],
  summary: {
    summary:
      "Maria has three years of customer support experience at a Pasig BPO, handling chat and email for an Australian telco. She described a clear, calm approach to billing disputes. She is comfortable with Sydney business hours and open to hybrid work. Salary expectations weren't discussed.",
    strengths: ["Relevant Australian telco support experience", "Structured approach to difficult customers", "Available for Sydney hours"],
    concerns: ["Mostly chat and email - limited phone experience mentioned", "Salary expectations not discussed"],
    scores: { communication: 4, englishFluency: 4, relevantExperience: 4, motivation: 3 },
    recommendation: "progress",
    model: "demo",
    writtenToJobAdderAt: null,
  },
};

function demoRecord(): InterviewRecord {
  return demo;
}
