import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Invite links carry a random token; only its SHA-256 hash is stored
// (cos_recruitment_bookings.invite_token_hash), so a database leak doesn't
// leak working links.
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// base64url, 43 chars for 32 bytes; anything else can't be a real token.
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
