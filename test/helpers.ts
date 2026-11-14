import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { app } from "../worker/app";
import { hashPassword } from "../worker/lib/password";

export const ORIGIN = "http://localhost";
export const TEST_ITERATIONS = 30_000;

export interface TestContext {
  env: Env;
  dispose: () => Promise<void>;
}

/** A fresh, fully migrated local D1 database for one test file. */
export async function createTestContext(): Promise<TestContext> {
  const template = process.env.TEST_DB_TEMPLATE;
  if (!template) throw new Error("global setup did not run");
  const dir = mkdtempSync(path.join(tmpdir(), "billing-test-file-"));
  cpSync(template, dir, { recursive: true });

  const proxy = await getPlatformProxy<Env>({ persist: { path: path.join(dir, "v3") } });
  const env = { ...proxy.env, PASSWORD_HASH_ITERATIONS: String(TEST_ITERATIONS) } as Env;
  return {
    env,
    dispose: async () => {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let userCounter = 0;

export interface CreatedUser {
  id: number;
  username: string;
  password: string;
}

export async function createUser(
  env: Env,
  options: { password?: string; isActive?: boolean; iterations?: number } = {},
): Promise<CreatedUser> {
  userCounter += 1;
  const username = `user${userCounter}_${Math.random().toString(36).slice(2, 8)}`;
  const password = options.password ?? "correct horse battery staple";
  const hash = await hashPassword(password, options.iterations ?? TEST_ITERATIONS);
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, is_active, password_changed_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'owner', ?4, ?5, ?5, ?5) RETURNING id`,
  )
    .bind(username, "Test Owner", hash, options.isActive === false ? 0 : 1, now)
    .first<{ id: number }>();
  if (!row) throw new Error("insert failed");
  return { id: row.id, username, password };
}

let ipCounter = 0;
/** Unique client IP per test so login throttling never leaks between tests. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}.1`;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string | null;
  ip?: string;
  origin?: string | null;
}

export async function call(env: Env, pathname: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers();
  const method = options.method ?? (options.body !== undefined || options.rawBody !== undefined ? "POST" : "GET");
  if (options.origin !== null && method !== "GET") headers.set("Origin", options.origin ?? ORIGIN);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.ip) headers.set("CF-Connecting-IP", options.ip);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  } else if (options.rawBody !== undefined) {
    headers.set("Content-Type", "application/json");
    body = options.rawBody;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return app.request(`${ORIGIN}${pathname}`, init, env);
}

/** Extracts "name=value" of the session cookie from a response, or null if cleared/absent. */
export function sessionCookie(res: Response): string | null {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("__Host-billing_session="));
  if (!header) return null;
  const pair = header.split(";")[0] ?? "";
  return pair.endsWith("=") ? "" : pair;
}

export async function login(env: Env, user: CreatedUser, ip = uniqueIp()): Promise<string> {
  const res = await call(env, "/api/auth/login", { body: { username: user.username, password: user.password }, ip });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = sessionCookie(res);
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

export async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code?: string } };
  return body.error?.code;
}
