import { Link, useNavigate } from "react-router";
import { formatDate } from "../../shared/gst";
import { formatPaise } from "../../shared/money";
import type { Overview } from "../../shared/stats";
import { useAuth } from "../auth/useAuth";
import { BarChart, monthLabel } from "../components/BarChart";
import { Alert, Card } from "../components/ui";
import { useFetch } from "../lib/useFetch";

function Metric({ label, value, note, to }: { label: string; value: string; note?: string | undefined; to?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </>
  );
  return to ? <Link to={to} className="block bg-white p-5 transition hover:bg-slate-50">{body}</Link> : <div className="bg-white p-5">{body}</div>;
}

const QUICK_ACTIONS = [
  { label: "New sale", to: "/sales/new", hint: "Scan serials to bill a retailer or walk-in" },
  { label: "New receipt", to: "/receipts/new", hint: "Money received against bills" },
  { label: "New purchase", to: "/purchases/new", hint: "Receive Havells stock by scanning serials" },
  { label: "New voucher", to: "/expenses/new", hint: "Rent, salary, electricity…" },
];

export function HomePage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const name = state.status === "authenticated" ? state.user.displayName : "";
  const { data, error } = useFetch<Overview>("/stats/overview");
  const rupees = (v: number | undefined) => (v === undefined ? "—" : `₹${formatPaise(v)}`);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Dashboard{data ? ` · ${formatDate(data.today)}` : ""}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Welcome back, {name}</h1>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {data && data.draftVouchers > 0 && (
        <Alert tone="info">
          {data.draftVouchers} voucher(s) waiting for approval. <Link className="font-medium underline" to="/expenses/approval">Review</Link>
        </Alert>
      )}

      <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Sales today" value={rupees(data?.salesToday.totalPaise)} note={data ? `${data.salesToday.count} invoice(s)` : undefined} to="/reports/sales" />
        <Metric label="This month" value={rupees(data?.salesMonth.totalPaise)} note={data ? `${data.salesMonth.count} invoice(s), net of returns` : undefined} to="/stats" />
        <Metric label="Collected today" value={rupees(data?.collectedTodayPaise)} note="Cash bills + receipts" to="/receipts" />
        <Metric label="Cash · Bank" value={data ? `₹${formatPaise(data.cashPaise)}` : "—"} note={data ? `Bank ₹${formatPaise(data.bankPaise)}` : undefined} to="/reports/ledger" />
        <Metric label="Receivables" value={rupees(data?.receivablePaise)} note={data?.overdue.amountPaise ? `₹${formatPaise(data.overdue.amountPaise)} overdue · ${data.overdue.parties} part(ies)` : "Nothing overdue"} to="/outstanding" />
        <Metric label="Payables" value={rupees(data?.payablePaise)} note="Owed to suppliers" to="/outstanding" />
        <Metric label="Stock value" value={rupees(data?.stockValuePaise)} note="At average cost (excl. GST)" to="/stock" />
        <Metric label="Low / out of stock" value={data ? `${data.lowStock} / ${data.outOfStock}` : "—"} note="2 or fewer left / none left" to="/stock" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Sales, last 6 months</h2>
            <Link to="/stats" className="text-xs font-semibold text-slate-600 hover:text-slate-900">Statistics →</Link>
          </div>
          {data && data.trend.every((t) => t.salesPaise === 0) && <p className="py-16 text-center text-sm text-slate-500">No sales yet. Your monthly sales will appear here.</p>}
          {data && data.trend.some((t) => t.salesPaise !== 0) && <BarChart labels={data.trend.map((t) => monthLabel(t.month))} series={[{ name: "Sales", className: "fill-slate-800", values: data.trend.map((t) => t.salesPaise) }]} />}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent invoices</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data?.recentSales.length === 0 && <li className="py-3 text-slate-500">No invoices yet.</li>}
            {data?.recentSales.map((s) => (
              <li key={s.id} className="flex cursor-pointer justify-between py-2.5 hover:bg-slate-50" onClick={() => navigate(`/sales/${s.id}`)}>
                <span><span className="font-mono">{s.invoiceNo}</span> <span className="text-slate-500">· {s.party}</span></span>
                <span className="tabular-nums">₹{formatPaise(s.totalPaise)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-4">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="group bg-white p-5 transition hover:bg-slate-50">
            <p className="font-medium text-slate-900">
              {a.label} <span className="inline-block transition group-hover:translate-x-0.5">→</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">{a.hint}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
