import { Link, useNavigate } from "react-router";
import { formatDate } from "../../shared/gst";
import { formatPaise } from "../../shared/money";
import type { Overview } from "../../shared/stats";
import { useAuth } from "../auth/useAuth";
import { BarChart, monthLabel } from "../components/BarChart";
import { Alert, Button, Card, HeaderLink } from "../components/ui";
import { useFetch } from "../lib/useFetch";

function Metric({ label, value, note, tone, to }: { label: string; value: string; note?: string | undefined; tone?: string; to: string }) {
  return (
    <Link to={to} className="erp-panel block p-5 transition hover:bg-slate-50">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${tone ?? "text-slate-900"}`}>{value}</p>
      {note && <p className="mt-1 text-sm text-slate-500">{note}</p>}
    </Link>
  );
}

const rupees = (v: number | undefined) => (v === undefined ? "—" : `₹${formatPaise(v)}`);

export function HomePage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const name = state.status === "authenticated" ? state.user.displayName : "";
  const { data, error } = useFetch<Overview>("/stats/overview");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back, {name}</h1>
          <p className="text-sm text-slate-600">{data ? formatDate(data.today) : "Dashboard"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && data.followUpsDue > 0 && <HeaderLink to="/follow-ups">{data.followUpsDue} follow-up(s) due</HeaderLink>}
          {data && data.draftVouchers > 0 && <HeaderLink to="/expenses/approval">{data.draftVouchers} expense(s) to approve</HeaderLink>}
          <Link to="/purchases/new"><Button variant="secondary">Add purchase</Button></Link>
          <Link to="/sales/new"><Button>New sale</Button></Link>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="To collect"
          value={rupees(data?.receivablePaise)}
          tone="text-green-700"
          note={data ? (data.overdue.amountPaise ? `₹${formatPaise(data.overdue.amountPaise)} overdue · ${data.overdue.parties} retailer(s)` : "Nothing overdue") : undefined}
          to="/outstanding"
        />
        <Metric label="To pay" value={rupees(data?.payablePaise)} tone="text-red-700" note="Owed to suppliers" to="/outstanding?kind=payment" />
        <Metric label="Sales this month" value={rupees(data?.salesMonth.totalPaise)} note={data ? `${data.salesMonth.count} invoice(s), net of returns` : undefined} to="/reports/sales" />
        <Metric label="Cash + bank" value={data ? rupees(data.cashPaise + data.bankPaise) : "—"} note={data ? `Cash ₹${formatPaise(data.cashPaise)} · Bank ₹${formatPaise(data.bankPaise)}` : undefined} to="/statement" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Sales, last 6 months</h2>
            <Link to="/reports/sales" className="text-sm font-semibold text-[var(--erp-blue)] hover:underline">Sales report</Link>
          </div>
          {data && data.trend.every((t) => t.salesPaise === 0) && <p className="py-16 text-center text-sm text-slate-500">No sales yet. Your monthly sales will appear here.</p>}
          {data && data.trend.some((t) => t.salesPaise !== 0) && (
            <BarChart labels={data.trend.map((t) => monthLabel(t.month))} series={[{ name: "Sales", className: "fill-[var(--erp-blue)]", values: data.trend.map((t) => t.salesPaise) }]} />
          )}
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Low stock</h2>
            <Link to="/stock" className="text-sm font-semibold text-[var(--erp-blue)] hover:underline">Stock report</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {data?.lowStockItems.length === 0 && <li className="py-3 text-slate-500">Nothing running low.</li>}
            {data?.lowStockItems.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-2.5">
                <Link to={`/products/${p.id}`} className="truncate hover:underline">{p.name}</Link>
                <span className={`shrink-0 font-semibold ${p.inStock <= 0 ? "text-red-700" : "text-amber-700"}`}>{p.inStock <= 0 ? "Out of stock" : `${p.inStock} left`}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Recent invoices</h2>
            <Link to="/sales" className="text-sm font-semibold text-[var(--erp-blue)] hover:underline">All sales</Link>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {data?.recentSales.length === 0 && <li className="py-3 text-slate-500">No invoices yet.</li>}
            {data?.recentSales.map((s) => (
              <li key={s.id} className="flex cursor-pointer justify-between gap-3 py-2.5 hover:bg-slate-50" onClick={() => navigate(`/sales/${s.id}`)}>
                <span className="truncate">
                  <Link to={`/sales/${s.id}`} className="font-semibold text-slate-900" onClick={(e) => e.stopPropagation()}>{s.invoiceNo}</Link>
                  <span className="text-slate-500"> · {s.party} · {formatDate(s.date)}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">₹{formatPaise(s.totalPaise)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900">Today</h2>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="flex justify-between py-2.5"><dt className="text-slate-600">Sales</dt><dd className="font-semibold tabular-nums">{rupees(data?.salesToday.totalPaise)}{data && <span className="font-normal text-slate-500"> · {data.salesToday.count}</span>}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-slate-600">Collected</dt><dd className="font-semibold tabular-nums">{rupees(data?.collectedTodayPaise)}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-slate-600">Stock value (avg. cost)</dt><dd className="font-semibold tabular-nums">{rupees(data?.stockValuePaise)}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-slate-600">Low / out of stock</dt><dd className="font-semibold tabular-nums">{data ? `${data.lowStock} / ${data.outOfStock}` : "—"}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
