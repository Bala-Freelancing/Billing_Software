// Brute-force protection, per client IP.
//
// Why per IP and not per username: there is a single owner account, so
// locking the *username* would let anyone on the internet lock the shop out of
// its own billing system by typing wrong passwords. Throttling per IP stops a
// single attacker; the 12+ character password policy makes distributed
// guessing impractical. For extra protection add a Cloudflare WAF rate-limit
// rule on /api/auth/* (see README).
import { AppError } from "../lib/errors";

export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_WINDOW = 10;

export async function assertNotThrottled(db: D1Database, ip: string, now: number): Promise<void> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS failures, MIN(attempted_at) AS oldest
         FROM login_failures
        WHERE ip = ?1 AND attempted_at > ?2`,
    )
    .bind(ip, now - FAILURE_WINDOW_MS)
    .first<{ failures: number; oldest: number | null }>();

  if (row && row.failures >= MAX_FAILURES_PER_WINDOW && row.oldest !== null) {
    const retryAfterSeconds = Math.max(1, Math.ceil((row.oldest + FAILURE_WINDOW_MS - now) / 1000));
    const minutes = Math.ceil(retryAfterSeconds / 60);
    // Deliberately writes nothing: a flood of blocked requests must not burn
    // the database's daily write quota.
    throw new AppError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      { retryAfterSeconds },
    );
  }
}

export function recordFailureStatement(db: D1Database, ip: string, now: number): D1PreparedStatement {
  return db.prepare("INSERT INTO login_failures (ip, attempted_at) VALUES (?1, ?2)").bind(ip, now);
}

export function clearFailuresStatement(db: D1Database, ip: string): D1PreparedStatement {
  return db.prepare("DELETE FROM login_failures WHERE ip = ?1").bind(ip);
}
