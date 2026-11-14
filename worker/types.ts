import type { SessionUser } from "../shared/auth";

export interface SessionContext {
  /** SHA-256 hex of the cookie token (the sessions table primary key). */
  id: string;
  expiresAt: number;
}

/** Hono generics for this Worker: bindings from wrangler.jsonc + per-request values. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    requestId: string;
    user: SessionUser;
    session: SessionContext;
  };
}
