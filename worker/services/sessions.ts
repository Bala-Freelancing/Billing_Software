// Server-side sessions. The browser holds a random 256-bit token in an
// HttpOnly cookie; the database stores only its SHA-256, so neither a script
// on the page nor a leaked database copy can be used to impersonate the owner.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Role, SessionUser } from "../../shared/auth";
import { bytesToBase64Url, bytesToHex } from "../lib/encoding";
import type { AppEnv } from "../types";

/** Sent as `__Host-billing_session`: HTTPS only, whole site, no subdomains. */
const COOKIE_NAME = "billing_session";
const TOKEN_BYTES = 32;
/** A token longer than this cannot be ours; reject before hashing. */
const MAX_TOKEN_LENGTH = 64;

/** "Stay signed in until logout": a session ends after 30 days without use. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Extending a session costs a database write, so do it at most once a day per
 * session rather than on every request (protects the free daily write quota).
 */
export const SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function sessionIdFromToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export function readSessionToken(c: Context<AppEnv>): string | null {
  const token = getCookie(c, COOKIE_NAME, "host");
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

export function writeSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: Math.floor(SESSION_IDLE_TIMEOUT_MS / 1000),
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE_NAME, { prefix: "host", secure: true, path: "/" });
}

export interface NewSession {
  id: string;
  userId: number;
  now: number;
  ip: string | null;
  userAgent: string | null;
}

export function insertSessionStatement(db: D1Database, s: NewSession): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)`,
    )
    .bind(s.id, s.userId, s.now, s.now + SESSION_IDLE_TIMEOUT_MS, s.ip, s.userAgent);
}

interface SessionRow {
  session_id: string;
  expires_at: number;
  last_seen_at: number;
  user_id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: number;
}

export type SessionLookup =
  | { status: "valid"; user: SessionUser; sessionId: string; expiresAt: number; needsRefresh: boolean }
  | { status: "invalid"; sessionId: string | null };

export async function lookupSession(db: D1Database, sessionId: string, now: number): Promise<SessionLookup> {
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
              u.id AS user_id, u.username, u.display_name, u.role, u.is_active
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?1`,
    )
    .bind(sessionId)
    .first<SessionRow>();

  if (!row) return { status: "invalid", sessionId: null };
  if (row.expires_at <= now || row.is_active !== 1) return { status: "invalid", sessionId: row.session_id };

  return {
    status: "valid",
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    needsRefresh: now - row.last_seen_at >= SESSION_REFRESH_INTERVAL_MS,
    user: { id: row.user_id, username: row.username, displayName: row.display_name, role: row.role },
  };
}

export async function refreshSession(db: D1Database, sessionId: string, now: number): Promise<number> {
  const expiresAt = now + SESSION_IDLE_TIMEOUT_MS;
  await db
    .prepare("UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE id = ?3")
    .bind(now, expiresAt, sessionId)
    .run();
  return expiresAt;
}

export function deleteSessionStatement(db: D1Database, sessionId: string): D1PreparedStatement {
  return db.prepare("DELETE FROM sessions WHERE id = ?1").bind(sessionId);
}

export function deleteUserSessionsStatement(db: D1Database, userId: number): D1PreparedStatement {
  return db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId);
}
