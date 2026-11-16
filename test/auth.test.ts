import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDailyCleanup } from "../worker/services/maintenance";
import { SESSION_REFRESH_INTERVAL_MS, sessionIdFromToken } from "../worker/services/sessions";
import { FAILURE_WINDOW_MS, MAX_FAILURES_PER_WINDOW } from "../worker/services/throttle";
import {
  call,
  createTestContext,
  createUser,
  errorCode,
  login,
  sessionCookie,
  uniqueIp,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let env: Env;

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
});
afterAll(async () => {
  await ctx.dispose();
});

const tokenOf = (cookie: string) => cookie.split("=")[1] ?? "";

async function sessionCount(userId: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("login", () => {
  it("signs in with correct credentials and sets a hardened session cookie", async () => {
    const user = await createUser(env);
    const res = await call(env, "/api/auth/login", { body: { username: user.username, password: user.password }, ip: uniqueIp() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: user.id, username: user.username, displayName: "Test Owner", role: "owner" } });

    const header = res.headers.getSetCookie().find((c) => c.startsWith("__Host-billing_session="));
    expect(header).toBeDefined();
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Domain=/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("stores only a hash of the session token", async () => {
    const user = await createUser(env);
    const cookie = await login(env, user);
    const token = tokenOf(cookie);
    const raw = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?1").bind(token).first();
    expect(raw).toBeNull();
    const hashed = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?1").bind(await sessionIdFromToken(token)).first();
    expect(hashed).not.toBeNull();
  });

  it("matches usernames case-insensitively and ignores surrounding spaces", async () => {
    const user = await createUser(env);
    const res = await call(env, "/api/auth/login", {
      body: { username: `  ${user.username.toUpperCase()} `, password: user.password },
      ip: uniqueIp(),
    });
    expect(res.status).toBe(200);
  });

  it("gives the same answer for a wrong password, an unknown user and a disabled account", async () => {
    const user = await createUser(env);
    const disabled = await createUser(env, { isActive: false });
    const attempts = [
      { username: user.username, password: "not the password" },
      { username: "nobody_here", password: "whatever" },
      { username: disabled.username, password: disabled.password },
    ];
    for (const body of attempts) {
      const res = await call(env, "/api/auth/login", { body, ip: uniqueIp() });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        error: { code: "INVALID_CREDENTIALS", message: "Incorrect username or password." },
      });
      expect(sessionCookie(res)).toBeNull();
    }
  });

  it("rejects malformed input with a validation error", async () => {
    const res = await call(env, "/api/auth/login", { body: { username: "a", password: "" }, ip: uniqueIp() });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields: Record<string, string[]> } };
    expect(body.error.code).toBe("VALIDATION");
    expect(Object.keys(body.error.fields).sort()).toEqual(["password", "username"]);

    const bad = await call(env, "/api/auth/login", { rawBody: "{not json", ip: uniqueIp() });
    expect(bad.status).toBe(400);
  });

  it("blocks state-changing requests from other sites or without an Origin header", async () => {
    const user = await createUser(env);
    const body = { username: user.username, password: user.password };
    const evil = await call(env, "/api/auth/login", { body, origin: "https://evil.example", ip: uniqueIp() });
    expect(evil.status).toBe(403);
    expect(await errorCode(evil)).toBe("FORBIDDEN_ORIGIN");
    const none = await call(env, "/api/auth/login", { body, origin: null, ip: uniqueIp() });
    expect(none.status).toBe(403);
  });

  it("writes audit entries for successful and failed sign-ins", async () => {
    const user = await createUser(env);
    await call(env, "/api/auth/login", { body: { username: user.username, password: "wrong one" }, ip: uniqueIp() });
    await login(env, user);
    const rows = await env.DB.prepare("SELECT action, details FROM audit_log WHERE user_id = ?1 ORDER BY id")
      .bind(user.id)
      .all<{ action: string; details: string | null }>();
    expect(rows.results.map((r) => r.action)).toEqual(["auth.login_failed", "auth.login_success"]);
    expect(JSON.parse(rows.results[0]?.details ?? "{}")).toMatchObject({ reason: "wrong_password" });
    // Passwords never reach the audit log.
    expect(JSON.stringify(rows.results)).not.toContain("wrong one");
  });

  it("upgrades an old password hash to the configured work factor on login", async () => {
    const user = await createUser(env, { iterations: 10_000 });
    await login(env, user);
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$30000\$/);
    await login(env, user); // still works after the upgrade
  });
});

describe("brute-force throttling", () => {
  it(`blocks an IP after ${MAX_FAILURES_PER_WINDOW} failures, even with the right password`, async () => {
    const user = await createUser(env);
    const ip = uniqueIp();
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) {
      const res = await call(env, "/api/auth/login", { body: { username: user.username, password: `wrong ${i}` }, ip });
      expect(res.status).toBe(401);
    }
    const blocked = await call(env, "/api/auth/login", { body: { username: user.username, password: user.password }, ip });
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe("TOO_MANY_ATTEMPTS");
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(FAILURE_WINDOW_MS / 1000);

    // A different IP (the real owner) is not affected.
    await login(env, user, uniqueIp());
  });

  it("does not write to the database while an IP is blocked", async () => {
    const user = await createUser(env);
    const ip = uniqueIp();
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) {
      await call(env, "/api/auth/login", { body: { username: user.username, password: `wrong ${i}` }, ip });
    }
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?1").bind(ip).first<{ n: number }>();
    await call(env, "/api/auth/login", { body: { username: user.username, password: "again" }, ip });
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?1").bind(ip).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("forgets old failures after the window and clears them on success", async () => {
    const user = await createUser(env);
    const ip = uniqueIp();
    const old = Date.now() - FAILURE_WINDOW_MS - 1000;
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) {
      await env.DB.prepare("INSERT INTO login_failures (ip, attempted_at) VALUES (?1, ?2)").bind(ip, old).run();
    }
    await call(env, "/api/auth/login", { body: { username: user.username, password: "one recent miss" }, ip });
    await login(env, user, ip);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?1").bind(ip).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("session", () => {
  it("returns the signed-in user from /me and 401 without a valid cookie", async () => {
    const user = await createUser(env);
    const cookie = await login(env, user);
    const me = await call(env, "/api/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { id: user.id } });

    for (const bad of [null, "__Host-billing_session=garbage", `__Host-billing_session=${"a".repeat(500)}`, "__Host-billing_session=../../etc"]) {
      const res = await call(env, "/api/auth/me", { cookie: bad });
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("UNAUTHENTICATED");
    }
  });

  it("ends an expired session, deletes it and clears the cookie", async () => {
    const user = await createUser(env);
    const cookie = await login(env, user);
    const id = await sessionIdFromToken(tokenOf(cookie));
    await env.DB.prepare("UPDATE sessions SET expires_at = ?1 WHERE id = ?2").bind(Date.now() - 1, id).run();

    const res = await call(env, "/api/auth/me", { cookie });
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toBe("");
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE id = ?1").bind(id).first()).toBeNull();
  });

  it("ends sessions of a disabled user immediately", async () => {
    const user = await createUser(env);
    const cookie = await login(env, user);
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?1").bind(user.id).run();
    expect((await call(env, "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("slides the expiry at most once a day", async () => {
    const user = await createUser(env);
    const cookie = await login(env, user);
    const id = await sessionIdFromToken(tokenOf(cookie));

    // Used again soon after sign-in: no write, no new cookie.
    const fresh = await call(env, "/api/auth/me", { cookie });
    expect(sessionCookie(fresh)).toBeNull();

    // Last used over a day ago: expiry is pushed forward and the cookie re-sent.
    const longAgo = Date.now() - SESSION_REFRESH_INTERVAL_MS - 1000;
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE id = ?3")
      .bind(longAgo, Date.now() + 1000, id)
      .run();
    const refreshed = await call(env, "/api/auth/me", { cookie });
    expect(refreshed.status).toBe(200);
    expect(sessionCookie(refreshed)).toBe(cookie);
    const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE id = ?1").bind(id).first<{ expires_at: number }>();
    expect(row?.expires_at).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it("replaces the previous session when signing in again on the same browser", async () => {
    const user = await createUser(env);
    const first = await login(env, user);
    const res = await call(env, "/api/auth/login", {
      body: { username: user.username, password: user.password },
      cookie: first,
      ip: uniqueIp(),
    });
    expect(res.status).toBe(200);
    expect((await call(env, "/api/auth/me", { cookie: first })).status).toBe(401);
    expect(await sessionCount(user.id)).toBe(1);
  });
});

describe("logout", () => {
  it("ends only the current session", async () => {
    const user = await createUser(env);
    const pc = await login(env, user);
    const phone = await login(env, user);
    const res = await call(env, "/api/auth/logout", { method: "POST", cookie: pc });
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toBe("");
    expect((await call(env, "/api/auth/me", { cookie: pc })).status).toBe(401);
    expect((await call(env, "/api/auth/me", { cookie: phone })).status).toBe(200);
  });

  it("is safe to call without a session", async () => {
    const res = await call(env, "/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
  });

  it("logout-all ends every session of the user", async () => {
    const user = await createUser(env);
    const other = await createUser(env);
    const a = await login(env, user);
    await login(env, user);
    const otherCookie = await login(env, other);
    const res = await call(env, "/api/auth/logout-all", { method: "POST", cookie: a });
    expect(res.status).toBe(204);
    expect(await sessionCount(user.id)).toBe(0);
    expect((await call(env, "/api/auth/me", { cookie: otherCookie })).status).toBe(200);
  });

  it("logout-all requires a session", async () => {
    expect((await call(env, "/api/auth/logout-all", { method: "POST" })).status).toBe(401);
  });
});

describe("change password", () => {
  const NEW_PASSWORD = "a brand new passphrase";

  it("rejects a wrong current password and counts it as a failed attempt", async () => {
    const user = await createUser(env);
    const ip = uniqueIp();
    const cookie = await login(env, user, ip);
    const res = await call(env, "/api/auth/change-password", {
      body: { currentPassword: "not it at all", newPassword: NEW_PASSWORD },
      cookie,
      ip,
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_CURRENT_PASSWORD");
    const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?1").bind(ip).first<{ n: number }>();
    expect(fails?.n).toBe(1);
  });

  it("enforces the password policy on the server", async () => {
    const user = await createUser(env);
    const cookie = await login(env, user);
    for (const newPassword of ["short", "aaaaaaaaaaaaaaaa", `my ${user.username} password`, user.password]) {
      const res = await call(env, "/api/auth/change-password", {
        body: { currentPassword: user.password, newPassword },
        cookie,
        ip: uniqueIp(),
      });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("VALIDATION");
    }
  });

  it("changes the password, signs out other devices and keeps this one signed in", async () => {
    const user = await createUser(env);
    const thisDevice = await login(env, user);
    const otherDevice = await login(env, user);

    const res = await call(env, "/api/auth/change-password", {
      body: { currentPassword: user.password, newPassword: NEW_PASSWORD },
      cookie: thisDevice,
      ip: uniqueIp(),
    });
    expect(res.status).toBe(200);
    const newCookie = sessionCookie(res);
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(thisDevice);

    expect((await call(env, "/api/auth/me", { cookie: otherDevice })).status).toBe(401);
    expect((await call(env, "/api/auth/me", { cookie: thisDevice })).status).toBe(401);
    expect((await call(env, "/api/auth/me", { cookie: newCookie })).status).toBe(200);
    expect(await sessionCount(user.id)).toBe(1);

    const oldLogin = await call(env, "/api/auth/login", { body: { username: user.username, password: user.password }, ip: uniqueIp() });
    expect(oldLogin.status).toBe(401);
    await login(env, { ...user, password: NEW_PASSWORD });

    const audit = await env.DB.prepare("SELECT 1 FROM audit_log WHERE user_id = ?1 AND action = 'auth.password_changed'")
      .bind(user.id)
      .first();
    expect(audit).not.toBeNull();
  });
});

describe("audit log integrity", () => {
  it("cannot be edited or deleted", async () => {
    const user = await createUser(env);
    await login(env, user);
    await expect(env.DB.prepare("UPDATE audit_log SET action = 'x' WHERE user_id = ?1").bind(user.id).run()).rejects.toThrow(
      /append-only/,
    );
    await expect(env.DB.prepare("DELETE FROM audit_log WHERE user_id = ?1").bind(user.id).run()).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("daily cleanup", () => {
  it("removes expired sessions and old login failures only", async () => {
    const user = await createUser(env);
    const live = await login(env, user);
    const dead = await login(env, user);
    const deadId = await sessionIdFromToken(tokenOf(dead));
    await env.DB.prepare("UPDATE sessions SET expires_at = ?1 WHERE id = ?2").bind(Date.now() - 1, deadId).run();
    await env.DB.prepare("INSERT INTO login_failures (ip, attempted_at) VALUES ('cleanup-old', ?1), ('cleanup-new', ?2)")
      .bind(Date.now() - 2 * 24 * 60 * 60 * 1000, Date.now())
      .run();

    const result = await runDailyCleanup(env.DB, Date.now());
    expect(result.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(result.oldLoginFailures).toBeGreaterThanOrEqual(1);
    expect((await call(env, "/api/auth/me", { cookie: live })).status).toBe(200);
    const left = await env.DB.prepare("SELECT ip FROM login_failures WHERE ip LIKE 'cleanup-%'").all<{ ip: string }>();
    expect(left.results.map((r) => r.ip)).toEqual(["cleanup-new"]);
  });
});

describe("API basics", () => {
  it("reports health", async () => {
    const res = await call(env, "/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers unknown routes with a JSON 404", async () => {
    const res = await call(env, "/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("rejects oversized request bodies", async () => {
    const res = await call(env, "/api/auth/login", {
      body: { username: "owner", password: "x".repeat(200 * 1024) },
      ip: uniqueIp(),
    });
    expect(res.status).toBe(413);
  });

  it("sets security headers on API responses, including errors", async () => {
    for (const res of [await call(env, "/api/health"), await call(env, "/api/auth/me")]) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-request-id")).toBeTruthy();
    }
  });
});
