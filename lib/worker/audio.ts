import "server-only";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Getting each raw audio track out of S3 and into a small file Whisper accepts.

let s3: S3Client | null = null;

export function recordingsBucketConfigured(): boolean {
  return Boolean(process.env.RECORDINGS_S3_BUCKET && process.env.RECORDINGS_S3_REGION);
}

// Credentials come from the standard AWS chain (AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY, or the server's instance role).
function client(): S3Client {
  return (s3 ??= new S3Client({ region: process.env.RECORDINGS_S3_REGION }));
}

export async function downloadTrack(s3Key: string, toPath: string): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: process.env.RECORDINGS_S3_BUCKET, Key: s3Key }));
  if (!res.Body) throw new Error(`Empty S3 object: ${s3Key}`);
  await pipeline(res.Body as Readable, createWriteStream(toPath));
}

// Mono 16 kHz Opus at 24 kbit/s: about 11 MB an hour, well under Groq's upload
// limit, and plenty for speech. Returns the duration in seconds.
export async function compressForSpeech(input: string, output: string): Promise<number> {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const stderr = await new Promise<string>((resolve, reject) => {
    // turbopackIgnore: the binary path is runtime config, not a project file to trace.
    const proc = spawn(/*turbopackIgnore: true*/ ffmpeg, ["-hide_banner", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", output]);
    let log = "";
    proc.stderr.on("data", (chunk) => (log = (log + chunk.toString()).slice(-8000)));
    proc.on("error", (err) => reject(new Error(`ffmpeg couldn't start (${ffmpeg}): ${err.message}`)));
    proc.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(`ffmpeg exited ${code}: ${log.slice(-500)}`))));
  });
  if ((await stat(output)).size === 0) throw new Error("ffmpeg produced an empty file");
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}
