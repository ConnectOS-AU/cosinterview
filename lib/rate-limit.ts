import "server-only";

// Small in-memory sliding-window limiter for the public candidate actions.
// Per server process, which is fine for a single Node server; move to the
// database or Redis if this ever runs on several instances.
const hits = new Map<string, number[]>();

export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear(); // crude cap so the map can't grow forever
  return true;
}
