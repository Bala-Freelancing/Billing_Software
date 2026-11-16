import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { stateName } from "../../../shared/india";
import type { ListResponse, Party } from "../../../shared/masters";
import { formatPaise } from "../../../shared/money";
import { Alert, Badge, Button, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

const TYPE_LABEL = { customer: "Retailer / customer", supplier: "Supplier", both: "Both" } as const;

export function PartiesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, status, page: String(page) });
  if (type) params.set("type", type);
  const { data, error, loading } = useFetch<ListResponse<Party>>(`/parties?${params}`);

  return (
    <div>
      <PageHeader
        title="Parties"
        subtitle="Retailers you sell to and suppliers you buy from."
        actions={
          <Link to="/parties/new">
            <Button>Add party</Button>
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[3fr_1fr_1fr]">
        <TextField label="" aria-label="Search parties" placeholder="Search name, phone, GSTIN, city" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <SelectField label="" aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          <option value="customer">Retailers / customers</option>
          <option value="supplier">Suppliers</option>
        </SelectField>
        <SelectField label="" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </SelectField>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">GSTIN</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Place</th>
              <th className="px-4 py-3 text-right">Opening ₹</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && (
              <tr><td colSpan={5} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>
            )}
            {data?.items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No parties found.</td></tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/parties/${p.id}`)}>
                <td className="px-4 py-3">
                  <Link to={`/parties/${p.id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                  <div className="mt-0.5 flex gap-1.5">
                    <Badge tone={p.partyType === "supplier" ? "amber" : "blue"}>{TYPE_LABEL[p.partyType]}</Badge>
                    {!p.isActive && <Badge>Inactive</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-slate-700">{p.gstin ?? "—"}</td>
                <td className="px-4 py-3">{p.phone || "—"}</td>
                <td className="px-4 py-3">{[p.city, stateName(p.stateCode)].filter(Boolean).join(", ")}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.openingBalancePaise === 0 ? "—" : (
                    <span className={p.openingBalancePaise > 0 ? "text-green-700" : "text-red-700"}>
                      {formatPaise(Math.abs(p.openingBalancePaise))} {p.openingBalancePaise > 0 ? "Dr" : "Cr"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
