import { useState } from "react";
import { Link, useParams } from "react-router";
import type { ListResponse, Party } from "../../../shared/masters";
import { formatPaise } from "../../../shared/money";
import { Alert, HeaderLink, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";
import { PartyFormPanel } from "./PartyFormPanel";

const TYPE_LABEL = { customer: "Retailer", supplier: "Supplier", both: "Both" } as const;

/** Retailers & suppliers: the add / edit form on top, the full list below (/parties, /parties/new, /parties/:id). */
export function PartiesPage() {
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, status, page: String(page) });
  if (type) params.set("type", type);
  const { data, error, loading, reload } = useFetch<ListResponse<Party>>(`/parties?${params}`);

  const filter = (setter: (v: string) => void) => (e: { target: { value: string } }) => {
    setter(e.target.value);
    setPage(1);
  };
  const first = data ? (data.page - 1) * data.pageSize : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Retailers & suppliers"
        actions={
          <>
            <HeaderLink to="/outstanding">Credit / outstanding</HeaderLink>
            <HeaderLink to="/statement">Statement of account</HeaderLink>
          </>
        }
      />

      <PartyFormPanel key={id ?? "new"} onSaved={reload} />

      <section className="erp-panel">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <h2 className="mr-auto text-base font-bold text-slate-900">
            Party list {data && <span className="text-sm font-medium text-slate-500">· {data.total} parties</span>}
          </h2>
          <SelectField label="" aria-label="Type" value={type} onChange={filter(setType)}>
            <option value="">All types</option>
            <option value="customer">Retailers</option>
            <option value="supplier">Suppliers</option>
          </SelectField>
          <SelectField label="" aria-label="Status" value={status} onChange={filter(setStatus)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </SelectField>
          <TextField label="" aria-label="Search parties" placeholder="Search name, mobile, GSTIN, city" value={q} onChange={filter(setQ)} />
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        {/* relative: keeps the sr-only header text inside the scroll box on phones */}
        <div className="relative overflow-x-auto">
          <table className="erp-table w-full min-w-[960px] text-sm">
            <thead className="erp-thead text-left">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Mobile</th>
                <th className="px-3 py-3">GSTIN</th>
                <th className="px-3 py-3">City</th>
                <th className="px-3 py-3 text-right">Credit limit ₹</th>
                <th className="px-3 py-3 text-right">Balance ₹</th>
                <th className="px-3 py-3">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data && (
                <tr>
                  <td colSpan={9} className="px-4 py-8">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No parties found.
                  </td>
                </tr>
              )}
              {data?.items.map((p, i) => {
                const overLimit = p.creditLimitPaise > 0 && p.balancePaise > p.creditLimitPaise;
                return (
                  <tr key={p.id} className={overLimit ? "!bg-red-50" : String(p.id) === id ? "!bg-[var(--erp-row-hover)]" : ""}>
                    <td className="px-3 py-2.5 text-slate-500">{first + i + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-slate-900">{p.name}</span>
                      {!p.isActive && <span className="ml-2 text-xs text-slate-500">Inactive</span>}
                    </td>
                    <td className="px-3 py-2.5">{TYPE_LABEL[p.partyType]}</td>
                    <td className="px-3 py-2.5 tabular-nums">{p.phone || "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{p.gstin ?? "—"}</td>
                    <td className="px-3 py-2.5">{p.city || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.creditLimitPaise ? formatPaise(p.creditLimitPaise) : "—"}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.balancePaise > 0 ? "text-green-700" : p.balancePaise < 0 ? "text-red-700" : "text-slate-500"}`}>
                      {p.balancePaise === 0 ? "0.00" : `${formatPaise(Math.abs(p.balancePaise))} ${p.balancePaise > 0 ? "to collect" : "to pay"}`}
                      {overLimit && <span className="block text-xs font-medium text-red-700">over limit</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/parties/${p.id}`}
                        onClick={() => window.scrollTo({ top: 0 })}
                        aria-label={`Edit ${p.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--erp-field-border)] text-[var(--erp-blue)] hover:bg-[var(--erp-row-hover)]"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="px-4 pb-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
