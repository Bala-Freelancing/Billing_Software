import { AppError } from "./errors";

/** True when a D1 error is a UNIQUE violation on the given "table.column". */
export function isUniqueViolation(err: unknown, column: string): boolean {
  const message = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : "";
  return message.includes("UNIQUE constraint failed") && message.includes(column);
}

/** Escapes % and _ so user search text is matched literally in LIKE ... ESCAPE '\'. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const conflict = () =>
  new AppError(409, "CONFLICT", "This record was changed by someone else. Reload the page and try again.");

export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found.`);

/** Field-level changes between two plain objects, for audit details. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt") continue;
    if (before[key] !== after[key]) changes[key] = [before[key], after[key]];
  }
  return changes;
}
