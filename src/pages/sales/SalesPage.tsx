import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { formatDate } from "../../../shared/gst";
import type { ListResponse } from "../../../shared/masters";
import { formatPaise } from "../../../shared/money";
import type { SaleSummary } from "../../../shared/sales";
import { Alert, Badge, Button, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

export function SalesPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [q, setQ] = useState(search.get("q") ?? ""); // ?q= from "Recent sales" on the sale screen
  const [status, setStatus] = useState("posted");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, status, page: String(page) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { data, error, loading } = useFetch<ListResponse<SaleSummary>>(`/sales?${params}`);
  const reset = () => setPage(1);

  return (
    <div>
      <PageHeader title="Sales" subtitle="GST tax invoices." actions={<Link to="/sales/new"><Button>New sale</Button></Link>} />
      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <TextField label="" aria-label="Search" placeholder="Invoice no., customer or phone" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        <TextField label="" aria-label="From date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <TextField label="" aria-label="To date" type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
        <SelectField label="" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </SelectField>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="erp-table-wrap">
        <table className="erp-table min-w-full text-sm">
          <thead className="erp-thead text-left">
            <tr><th className="px-4 py-3">Invoice no.</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Collection</th><th className="px-4 py-3 text-right">Amount ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && <tr><td colSpan={5} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
            {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No invoices found.</td></tr>}
            {data?.items.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/sales/${s.id}`)}>
                <td className="px-4 py-3 font-mono font-medium text-slate-900">{s.invoiceNo} {s.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}</td>
                <td className="px-4 py-3 tabular-nums">{formatDate(s.invoiceDate)}</td>
                <td className="px-4 py-3">{s.billName}</td>
                <td className="px-4 py-3">{s.collectionType === "credit" ? <Badge tone="amber">Credit</Badge> : <Badge tone="green">Paid</Badge>}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(s.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
