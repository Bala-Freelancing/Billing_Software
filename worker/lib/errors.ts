import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "../../shared/auth";
import type { AppEnv } from "../types";

interface AppErrorExtras {
  fields?: Record<string, string[]>;
  retryAfterSeconds?: number;
}

/** An expected failure with a stable machine-readable code and a safe message. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly extras: AppErrorExtras = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");

export function errorResponse(c: Context<AppEnv>, err: AppError) {
  const body: ApiErrorBody = {
    error: { code: err.code, message: err.message, requestId: c.get("requestId") },
  };
  if (err.extras.fields) body.error.fields = err.extras.fields;
  if (err.extras.retryAfterSeconds !== undefined) {
    body.error.retryAfterSeconds = err.extras.retryAfterSeconds;
    c.header("Retry-After", String(err.extras.retryAfterSeconds));
  }
  return c.json(body, err.status);
}

/** Global error handler: known errors pass through, everything else is a logged 500. */
export function handleError(err: Error, c: Context<AppEnv>) {
  if (err instanceof AppError) return errorResponse(c, err);

  if (err instanceof HTTPException && err.status < 500) {
    // Raised by Hono itself, e.g. malformed JSON or a wrong Content-Type.
    return errorResponse(c, new AppError(err.status as ContentfulStatusCode, "BAD_REQUEST", err.message));
  }

  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      stack: err.stack,
    }),
  );
  return errorResponse(c, new AppError(500, "INTERNAL", "Something went wrong. Please try again."));
}
