// Mid-batch assertions. A guard statement inserts 0 into batch_guards when its
// condition is false; the CHECK (ok = 1) then aborts the whole transaction.

/** Statement that aborts the batch unless `condition` (SQL) is true at that point. */
export const guard = (db: D1Database, condition: string, ...binds: unknown[]) =>
  db.prepare(`INSERT INTO batch_guards (ok) SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END`).bind(...binds);

/** Clears passed guards so batch_guards stays empty; put once after the guards. */
export const clearGuards = (db: D1Database) => db.prepare("DELETE FROM batch_guards");

export const isGuardFailure = (err: unknown) =>
  err instanceof Error && /CHECK constraint failed: ok = 1/.test(`${err.message} ${String((err as { cause?: unknown }).cause ?? "")}`);
