import { useDeferredValue, useId, useState } from "react";
import type { ListResponse } from "../../shared/masters";
import { useFetch } from "../lib/useFetch";

interface SearchPickerProps<T extends { id: number }> {
  label: string;
  /** API list path without query string, e.g. "/parties". */
  path: string;
  extraParams?: Record<string, string>;
  selected: T | null;
  onSelect: (item: T | null) => void;
  render: (item: T) => { title: string; subtitle?: string };
  placeholder?: string;
  errors?: string[] | undefined;
}

/** Type-to-search picker backed by a paginated list endpoint. */
export function SearchPicker<T extends { id: number }>({
  label,
  path,
  extraParams,
  selected,
  onSelect,
  render,
  placeholder = "Type to search…",
  errors,
}: SearchPickerProps<T>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const deferred = useDeferredValue(query);
  const params = new URLSearchParams({ q: deferred, ...extraParams });
  const { data, loading } = useFetch<ListResponse<T>>(open ? `${path}?${params}` : null);

  if (selected) {
    const r = render(selected);
    return (
      <div>
        <p className="block text-sm font-medium text-slate-700">{label}</p>
        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{r.title}</p>
            {r.subtitle && <p className="truncate text-xs text-slate-500">{r.subtitle}</p>}
          </div>
          <button type="button" className="shrink-0 text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={() => onSelect(null)}>
            Change
          </button>
        </div>
        {errors?.length ? <p className="mt-1.5 text-sm text-red-700">{errors[0]}</p> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-invalid={errors?.length ? true : undefined}
        className={`mt-1 block w-full rounded-lg border-0 px-3 py-2.5 text-slate-900 shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset sm:text-sm ${
          errors?.length ? "ring-red-400 focus:ring-red-600" : "ring-slate-300 focus:ring-slate-900"
        }`}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && !data && <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>}
          {data?.items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matches</li>}
          {data?.items.map((item) => {
            const r = render(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(item);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="block text-sm font-medium text-slate-900">{r.title}</span>
                  {r.subtitle && <span className="block text-xs text-slate-500">{r.subtitle}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {errors?.length ? <p className="mt-1.5 text-sm text-red-700">{errors[0]}</p> : null}
    </div>
  );
}
