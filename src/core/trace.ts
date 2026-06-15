import crypto from "crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateUlid(): string {
  const now = Date.now();
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[t & 31] + ts;
    t = Math.floor(t / 32);
  }
  const rand = crypto.randomBytes(10);
  let r = "";
  for (let i = 0; i < 10; i++) r += CROCKFORD[rand[i] & 31];
  while (r.length < 16) r += CROCKFORD[0];
  return ts + r;
}

const MAX_SESSIONS = 200;

/**
 * Per-turn trace correlation, keyed by `sessionID`.
 *
 * opencode instantiates the plugin once per instance (verified H-C1), so the
 * map lives in memory for the instance lifetime — no file persistence needed.
 * `chat.message` (turn-START) rotates a new ULID trace for its session; every
 * subsequent hook in the turn reuses it. Keyed by sessionID so concurrent
 * sessions don't collide.
 */
export class TraceManager {
  private map = new Map<string, string>();

  /** Start a new trace for this session (called on chat.message / turn-START). */
  newTrace(sessionId?: string): string {
    const key = sessionId || "default";
    const traceId = generateUlid();
    this.map.set(key, traceId);
    // Cap to avoid unbounded growth over a long-lived instance.
    if (this.map.size > MAX_SESSIONS) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return traceId;
  }

  /** Current trace for this session; create one if none exists yet. */
  currentTrace(sessionId?: string): string {
    const key = sessionId || "default";
    return this.map.get(key) ?? this.newTrace(key);
  }
}
