import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Turns the merged English transcript into a short recruiter-facing summary
// and 1-5 scores. Advisory only: the recruiter's own judgement and notes stand.

export const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "claude-opus-5-5";

export type InterviewSummary = {
  summary: string;
  strengths: string[];
  concerns: string[];
  scores: { communication: number; englishFluency: number; relevantExperience: number; motivation: number };
  recommendation: "progress" | "maybe" | "do_not_progress";
};

export function summaryConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const score = { type: "integer", enum: [1, 2, 3, 4, 5] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "concerns", "scores", "recommendation"],
  properties: {
    summary: { type: "string", description: "4-6 sentences a recruiter can paste into JobAdder." },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["communication", "englishFluency", "relevantExperience", "motivation"],
      properties: { communication: score, englishFluency: score, relevantExperience: score, motivation: score },
    },
    recommendation: { type: "string", enum: ["progress", "maybe", "do_not_progress"] },
  },
};

const SYSTEM = `You help ConnectOS recruiters review first-round video interviews for offshore roles based in the Philippines.
You get an English transcript (machine-translated from English and Tagalog, so expect some translation noise) with speaker labels, the role, and the recruiter's own notes.
Summarise what the candidate actually said: experience, skills, availability, salary expectations and questions they asked. Base every point on the transcript or notes; if something wasn't covered, don't guess - say it wasn't discussed.
Score only what the interview shows. Judge English fluency from the parts the candidate spoke in English; don't penalise switching to Tagalog.
Ignore anything about age, religion, health, family plans, ethnicity or other protected attributes, even if it came up.`;

let client: Anthropic | null = null;

export async function summariseInterview(input: {
  jobTitle: string | null;
  clientName: string | null;
  candidateName: string;
  transcript: string;
  notes: string[];
}): Promise<InterviewSummary> {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Role: ${input.jobTitle ?? "not given"}${input.clientName ? ` (client: ${input.clientName})` : ""}`,
          `Candidate: ${input.candidateName}`,
          `Recruiter's notes:\n${input.notes.length ? input.notes.map((n) => `- ${n}`).join("\n") : "(none)"}`,
          `Transcript:\n${input.transcript}`,
        ].join("\n\n"),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The summary model declined this transcript.");
  if (response.stop_reason === "max_tokens") throw new Error("The summary was cut off.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as InterviewSummary;
}
