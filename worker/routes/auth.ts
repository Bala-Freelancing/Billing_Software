import { Hono } from "hono";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  passwordProblems,
  type AuthUserResponse,
  type Role,
} from "../../shared/auth";
import { auditStatement } from "../lib/audit";
import { getConfig } from "../lib/config";
import { AppError } from "../lib/errors";
import { hashPassword, simulatePasswordCheck, verifyPassword } from "../lib/password";
import { clientIp, userAgent } from "../lib/request";
import { requireAuth, validate } from "../middleware";
import {
  clearSessionCookie,
  deleteSessionStatement,
  deleteUserSessionsStatement,
  generateSessionToken,
  insertSessionStatement,
  readSessionToken,
  sessionIdFromToken,
  writeSessionCookie,
} from "../services/sessions";
import { assertNotThrottled, clearFailuresStatement, recordFailureStatement } from "../services/throttle";
import type { AppEnv } from "../types";

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: number;
  password_hash: string;
}

const INVALID_CREDENTIALS = () =>
  // One message for every failure reason, so the response never reveals
  // whether the username exists or the account is disabled.
  new AppError(401, "INVALID_CREDENTIALS", "Incorrect username or password.");

export const authRoutes = new Hono<AppEnv>()
  .post("/login", validate("json", loginRequestSchema), async (c) => {
    const { username, password } = c.req.valid("json");
    const db = c.env.DB;
    const { passwordHashIterations } = getConfig(c.env);
    const now = Date.now();
    const ip = clientIp(c);
    const ua = userAgent(c);

    await assertNotThrottled(db, ip, now);

    const user = await db
      .prepare(
        "SELECT id, username, display_name, role, is_active, password_hash FROM users WHERE username = ?1",
      )
      .bind(username)
      .first<UserRow>();

    let valid = false;
    let needsRehash = false;
    if (user) {
      ({ valid, needsRehash } = await verifyPassword(password, user.password_hash, passwordHashIterations));
    } else {
      await simulatePasswordCheck(password, passwordHashIterations);
    }

    if (!user || !valid || user.is_active !== 1) {
      const reason = !user ? "unknown_user" : !valid ? "wrong_password" : "inactive";
      await db.batch([
        recordFailureStatement(db, ip, now),
        auditStatement(db, {
          action: "auth.login_failed",
          userId: user?.id ?? null,
          ip,
          userAgent: ua,
          at: now,
          details: { username, reason },
        }),
      ]);
      throw INVALID_CREDENTIALS();
    }

    const token = generateSessionToken();
    const sessionId = await sessionIdFromToken(token);
    const statements: D1PreparedStatement[] = [
      insertSessionStatement(db, { id: sessionId, userId: user.id, now, ip, userAgent: ua }),
      clearFailuresStatement(db, ip),
      auditStatement(db, { action: "auth.login_success", userId: user.id, ip, userAgent: ua, at: now }),
    ];

    // Signing in again on the same browser replaces its previous session.
    const previousToken = readSessionToken(c);
    if (previousToken) {
      statements.push(deleteSessionStatement(db, await sessionIdFromToken(previousToken)));
    }

    // The configured work factor changed since this hash was made: upgrade it.
    if (needsRehash) {
      const upgraded = await hashPassword(password, passwordHashIterations);
      statements.push(
        db
          .prepare("UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3")
          .bind(upgraded, now, user.id),
      );
    }

    await db.batch(statements);
    writeSessionCookie(c, token);

    const body: AuthUserResponse = {
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
    };
    return c.json(body);
  })

  // Idempotent: always succeeds and always clears the cookie.
  .post("/logout", async (c) => {
    const token = readSessionToken(c);
    if (token) {
      const db = c.env.DB;
      const sessionId = await sessionIdFromToken(token);
      const deleted = await db
        .prepare("DELETE FROM sessions WHERE id = ?1 RETURNING user_id")
        .bind(sessionId)
        .first<{ user_id: number }>();
      if (deleted) {
        await auditStatement(db, {
          action: "auth.logout",
          userId: deleted.user_id,
          ip: clientIp(c),
          userAgent: userAgent(c),
          at: Date.now(),
        }).run();
      }
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  })

  .get("/me", requireAuth, (c) => {
    const body: AuthUserResponse = { user: c.get("user") };
    return c.json(body);
  })

  .post("/logout-all", requireAuth, async (c) => {
    const db = c.env.DB;
    const user = c.get("user");
    await db.batch([
      deleteUserSessionsStatement(db, user.id),
      auditStatement(db, {
        action: "auth.logout_all",
        userId: user.id,
        ip: clientIp(c),
        userAgent: userAgent(c),
        at: Date.now(),
      }),
    ]);
    clearSessionCookie(c);
    return c.body(null, 204);
  })

  .post("/change-password", requireAuth, validate("json", changePasswordRequestSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");
    const db = c.env.DB;
    const { passwordHashIterations } = getConfig(c.env);
    const user = c.get("user");
    const now = Date.now();
    const ip = clientIp(c);
    const ua = userAgent(c);

    const problems = passwordProblems(newPassword, user.username);
    if (problems.length > 0) {
      throw new AppError(400, "VALIDATION", "Choose a stronger new password.", {
        fields: { newPassword: problems },
      });
    }

    // Same throttle as login, so a stolen open session cannot be used to
    // brute-force the current password.
    await assertNotThrottled(db, ip, now);

    const row = await db
      .prepare("SELECT password_hash FROM users WHERE id = ?1")
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");

    const { valid } = await verifyPassword(currentPassword, row.password_hash, passwordHashIterations);
    if (!valid) {
      await db.batch([
        recordFailureStatement(db, ip, now),
        auditStatement(db, { action: "auth.password_change_failed", userId: user.id, ip, userAgent: ua, at: now }),
      ]);
      throw new AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect.", {
        fields: { currentPassword: ["Current password is incorrect."] },
      });
    }

    const newHash = await hashPassword(newPassword, passwordHashIterations);
    const token = generateSessionToken();
    const sessionId = await sessionIdFromToken(token);

    // One transaction: new password, every old session revoked (other devices
    // are signed out), a fresh session for this device, and the audit entry.
    await db.batch([
      db
        .prepare("UPDATE users SET password_hash = ?1, password_changed_at = ?2, updated_at = ?2 WHERE id = ?3")
        .bind(newHash, now, user.id),
      deleteUserSessionsStatement(db, user.id),
      insertSessionStatement(db, { id: sessionId, userId: user.id, now, ip, userAgent: ua }),
      clearFailuresStatement(db, ip),
      auditStatement(db, { action: "auth.password_changed", userId: user.id, ip, userAgent: ua, at: now }),
    ]);
    writeSessionCookie(c, token);

    const body: AuthUserResponse = { user };
    return c.json(body);
  });
