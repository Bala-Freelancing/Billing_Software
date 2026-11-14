import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUserResponse, LoginRequest, SessionUser } from "../../shared/auth";
import { api, ApiError, setUnauthorizedListener } from "../lib/api";

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: SessionUser }
  /** The server could not be reached while checking the session. */
  | { status: "unavailable"; message: string };

export interface AuthContextValue {
  state: AuthState;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  /** Re-checks the session with the server (used by the "try again" button). */
  recheck: () => void;
  /** Updates the signed-in user after an action that returns one (e.g. password change). */
  setUser: (user: SessionUser) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [checkCount, setCheckCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<AuthUserResponse>("/auth/me", { signal: controller.signal })
      .then(({ user }) => setState({ status: "authenticated", user }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) setState({ status: "anonymous" });
        else setState({ status: "unavailable", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [checkCount]);

  // Any API call that discovers the session ended sends the user back to login.
  useEffect(() => {
    setUnauthorizedListener(() => setState({ status: "anonymous" }));
    return () => setUnauthorizedListener(null);
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const { user } = await api<AuthUserResponse>("/auth/login", { method: "POST", body: credentials });
    setState({ status: "authenticated", user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      // Even if the network call fails, never leave the UI looking signed in.
      setState({ status: "anonymous" });
    }
  }, []);

  const logoutAllDevices = useCallback(async () => {
    await api("/auth/logout-all", { method: "POST" });
    setState({ status: "anonymous" });
  }, []);

  const recheck = useCallback(() => {
    setState({ status: "loading" });
    setCheckCount((n) => n + 1);
  }, []);

  const setUser = useCallback((user: SessionUser) => setState({ status: "authenticated", user }), []);

  const value = useMemo(
    () => ({ state, login, logout, logoutAllDevices, recheck, setUser }),
    [state, login, logout, logoutAllDevices, recheck, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
