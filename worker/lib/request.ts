import type { Context } from "hono";
import type { AppEnv } from "../types";

const MAX_USER_AGENT_LENGTH = 256;

/** The visitor's IP as seen by Cloudflare. Falls back to "unknown" in local dev. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

export function userAgent(c: Context<AppEnv>): string | null {
  const ua = c.req.header("user-agent");
  return ua ? ua.slice(0, MAX_USER_AGENT_LENGTH) : null;
}
