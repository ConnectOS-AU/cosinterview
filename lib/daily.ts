import "server-only";

// Daily REST API. Rooms are private with knocking on: the candidate joins
// without a meeting token, which puts them in the lobby until the recruiter
// (who joins with an owner token) lets them in.

const API = "https://api.daily.co/v1";

export function dailyConfigured(): boolean {
  return Boolean(process.env.DAILY_API_KEY);
}

async function daily<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return { status: res.status, json: (await res.json()) as T };
}

type Room = { name: string; url: string };

// Creates the room for one booking, or returns it if it already exists (so a
// retry after a partial failure is safe). Open from 15 minutes before the start
// until an hour after the scheduled end.
export async function ensureInterviewRoom(
  name: string,
  window: { start: string; end: string },
): Promise<Room> {
  const nbf = Math.floor(new Date(window.start).getTime() / 1000) - 15 * 60;
  const exp = Math.floor(new Date(window.end).getTime() / 1000) + 60 * 60;
  const created = await daily<Room & { info?: string; error?: string }>("POST", "/rooms", {
    name,
    privacy: "private",
    properties: {
      nbf,
      exp,
      eject_at_room_exp: true,
      enable_knocking: true,
      enable_prejoin_ui: false,
      enable_recording: "raw-tracks",
    },
  });
  if (created.status === 200) return { name: created.json.name, url: created.json.url };

  const existing = await daily<Room>("GET", `/rooms/${encodeURIComponent(name)}`);
  if (existing.status === 200) return { name: existing.json.name, url: existing.json.url };
  throw new Error(`Daily room create failed: ${created.status} ${JSON.stringify(created.json)}`);
}

// Meeting token for the recruiter: owner, so they skip the lobby, can admit the
// candidate and can start recording. user_id tags their audio track as the
// recruiter's for the transcription worker.
export async function createOwnerToken(
  roomName: string,
  owner: { name: string; recruiterId: string },
): Promise<string> {
  const res = await daily<{ token?: string }>("POST", "/meeting-tokens", {
    properties: {
      room_name: roomName,
      is_owner: true,
      user_name: owner.name,
      user_id: `recruiter:${owner.recruiterId}`,
      exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
    },
  });
  if (res.status !== 200 || !res.json.token) throw new Error(`Daily token create failed: ${res.status}`);
  return res.json.token;
}
