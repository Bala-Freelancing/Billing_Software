import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { FullPageMessage } from "../components/ui";

export function NotFoundPage() {
  return (
    <FullPageMessage>
      <div className="text-center">
        <p className="text-sm font-semibold text-blue-700">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
        <Link to="/" className="mt-6 inline-block text-sm font-semibold text-blue-700 hover:underline">
          Go to home
        </Link>
      </div>
    </FullPageMessage>
  );
}

/** Shown if a page crashes, instead of a blank white screen. */
export function RouteErrorPage() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null;
  return (
    <FullPageMessage>
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">Reload the page to continue. If it keeps happening, note the message below.</p>
        {detail && <p className="mt-3 rounded bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">{detail}</p>}
        <button
          onClick={() => window.location.reload()}
          className="mt-6 text-sm font-semibold text-blue-700 hover:underline"
        >
          Reload
        </button>
      </div>
    </FullPageMessage>
  );
}
