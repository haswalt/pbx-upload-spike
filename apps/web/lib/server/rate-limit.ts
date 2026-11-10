import "server-only";

/**
 * Per-user sliding-window limiter for SAS issuance.
 *
 * In-memory: on Vercel each function instance has its own window, so this is
 * a speed bump, not a guarantee. Production should use a shared store
 * (e.g. Upstash Redis / Azure Cache) or an edge/WAF rule.
 */
const windows = new Map<string, number[]>();
const WINDOW_MS = 60_000;

export function takeToken(key: string, limit: number): boolean {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  return true;
}
