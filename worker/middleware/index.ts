import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler, ValidationTargets } from "hono";
import { z } from "zod";
import { AppError, unauthenticated } from "../lib/errors";
import {
  clearSessionCookie,
  lookupSession,
  readSessionToken,
  refreshSession,
  sessionIdFromToken,
  writeSessionCookie,
} from "../services/sessions";
import type { AppEnv } from "../types";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Request id for log correlation, and API responses that are never cached. */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Request-Id", c.get("requestId"));
};

/**
 * CSRF defence in depth (the session cookie is already SameSite=Strict):
 * state-changing requests must come from this site's own pages. Browsers
 * always send Origin on POST/PUT/PATCH/DELETE.
 */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    if (!origin || origin !== new URL(c.req.url).origin) {
      throw new AppError(403, "FORBIDDEN_ORIGIN", "This request was blocked for security reasons.");
    }
  }
  await next();
};

/** Loads the signed-in user, or answers 401. Slides the session expiry daily. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c);
  if (!token) throw unauthenticated();

  const db = c.env.DB;
  const now = Date.now();
  const sessionId = await sessionIdFromToken(token);
  const result = await lookupSession(db, sessionId, now);

  if (result.status === "invalid") {
    if (result.sessionId) {
      await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(result.sessionId).run();
    }
    clearSessionCookie(c);
    throw unauthenticated();
  }

  let expiresAt = result.expiresAt;
  if (result.needsRefresh) {
    expiresAt = await refreshSession(db, result.sessionId, now);
    writeSessionCookie(c, token);
  }

  c.set("user", result.user);
  c.set("session", { id: result.sessionId, expiresAt });
  await next();
};

/** Validates a request part with zod and returns a uniform 400 on failure. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const flat = z.flattenError(result.error);
      throw new AppError(400, "VALIDATION", flat.formErrors[0] ?? "Please check the highlighted fields.", {
        fields: flat.fieldErrors as Record<string, string[]>,
      });
    }
  });
}
