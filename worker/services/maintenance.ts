/** Login-failure rows are only needed for the 15-minute throttle window. */
const LOGIN_FAILURE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  expiredSessions: number;
  oldLoginFailures: number;
}

/** Runs daily from the cron trigger. Safe to run any number of times. */
export async function runDailyCleanup(db: D1Database, now: number): Promise<CleanupResult> {
  const [sessions, failures] = await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    db.prepare("DELETE FROM login_failures WHERE attempted_at < ?1").bind(now - LOGIN_FAILURE_RETENTION_MS),
  ]);
  return {
    expiredSessions: sessions?.meta.changes ?? 0,
    oldLoginFailures: failures?.meta.changes ?? 0,
  };
}
