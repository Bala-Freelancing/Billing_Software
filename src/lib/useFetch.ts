import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

export interface FetchState<T> {
  /** Last loaded data; kept while a reload is in flight so lists don't flash empty. */
  data: T | null;
  error: string | null;
  /** True until the response for the current path (and reload) arrives. */
  loading: boolean;
  reload: () => void;
}

interface Loaded<T> {
  key: string | null;
  data: T | null;
  error: string | null;
}

/** Loads JSON from the API whenever `path` changes. Pass null to skip. */
export function useFetch<T>(path: string | null): FetchState<T> {
  const [version, setVersion] = useState(0);
  const key = path === null ? null : `${path}#${version}`;
  const [loaded, setLoaded] = useState<Loaded<T>>({ key: null, data: null, error: null });

  useEffect(() => {
    if (path === null || key === null) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then((data) => setLoaded({ key, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof ApiError ? err.message : "Could not load data.";
        setLoaded((prev) => ({ key, data: prev.data, error }));
      });
    return () => controller.abort();
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = loaded.key === key;
  return {
    data: loaded.data,
    error: current ? loaded.error : null,
    loading: key !== null && !current,
    reload,
  };
}
