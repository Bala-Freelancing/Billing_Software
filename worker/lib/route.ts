import type { Context } from "hono";
import type { AppEnv } from "../types";
import { auditStatement, type AuditAction } from "./audit";
import { notFound } from "./db";
import { clientIp, userAgent } from "./request";

export type Ctx = Context<AppEnv>;

export const idParam = (c: Ctx, name = "id") => {
  const id = Number(c.req.param(name));
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Record");
  return id;
};

/** Next updated_at: never equal to the previous value, so optimistic locking always detects a change. */
export const nextStamp = (previous: number) => Math.max(Date.now(), previous + 1);

export function audit(c: Ctx, action: AuditAction, details: Record<string, unknown>) {
  return auditStatement(c.env.DB, {
    action,
    userId: c.get("user").id,
    ip: clientIp(c),
    userAgent: userAgent(c),
    at: Date.now(),
    details,
  });
}

/**
 * Audit row written only if the immediately preceding statement in the same
 * batch changed a row, so a lost race leaves no audit entry.
 */
export function auditIfChanged(c: Ctx, action: AuditAction, details: Record<string, unknown>) {
  return c.env.DB.prepare(
    `INSERT INTO audit_log (created_at, user_id, action, ip, user_agent, details)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE changes() > 0`,
  ).bind(Date.now(), c.get("user").id, action, clientIp(c), userAgent(c), JSON.stringify(details));
}
