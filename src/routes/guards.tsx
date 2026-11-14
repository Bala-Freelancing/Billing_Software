import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth/useAuth";
import { Button, FullPageMessage, Spinner } from "../components/ui";

export interface LoginRedirectState {
  from?: string;
}

function CheckingSession() {
  return (
    <FullPageMessage>
      <div className="flex items-center gap-3 text-slate-600">
        <Spinner />
        <span>Loading…</span>
      </div>
    </FullPageMessage>
  );
}

function ServerUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <FullPageMessage>
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-slate-900">Can't connect</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <Button className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </FullPageMessage>
  );
}

/** Renders child routes only for a signed-in user; otherwise sends them to /login. */
export function RequireAuth() {
  const { state, recheck } = useAuth();
  const location = useLocation();

  switch (state.status) {
    case "loading":
      return <CheckingSession />;
    case "unavailable":
      return <ServerUnavailable message={state.message} onRetry={recheck} />;
    case "anonymous": {
      const redirect: LoginRedirectState = { from: location.pathname + location.search };
      return <Navigate to="/login" replace state={redirect} />;
    }
    case "authenticated":
      return <Outlet />;
  }
}

/** The login page itself: a signed-in user is sent straight to the app. */
export function GuestOnly() {
  const { state, recheck } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <CheckingSession />;
  if (state.status === "unavailable") return <ServerUnavailable message={state.message} onRetry={recheck} />;
  if (state.status === "authenticated") {
    const from = (location.state as LoginRedirectState | null)?.from;
    // Only follow same-app paths, never an absolute URL (open-redirect guard).
    const target = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}
