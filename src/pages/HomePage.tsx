import { Link } from "react-router";
import type { DashboardSummary } from "../../shared/masters";
import { formatPaise } from "../../shared/money";
import { useAuth } from "../auth/useAuth";
import { Alert } from "../components/ui";
import { useFetch } from "../lib/useFetch";

function Metric({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="border-slate-200 p-6">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

const QUICK_ACTIONS = [
  { label: "Add product", to: "/products/new", hint: "Havells item with HSN, GST and price" },
  { label: "Add party", to: "/parties/new", hint: "Retailer or supplier with GSTIN" },
  { label: "Shop settings", to: "/settings", hint: "GSTIN, address and bank on invoices" },
];

export function HomePage() {
  const { state } = useAuth();
  const name = state.status === "authenticated" ? state.user.displayName : "";
  const { data, error } = useFetch<DashboardSummary>("/dashboard");
  const rupees = (v: number | undefined) => (v === undefined ? "—" : `₹${formatPaise(v)}`);
  const count = (v: number | undefined) => (v === undefined ? "—" : String(v));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">Dashboard</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Welcome back, {name}</h1>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Bordered grid of metric counters */}
      <div className="grid divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <Metric label="Receivables" value={rupees(data?.receivablePaise)} note="Owed to the shop" />
        <Metric label="Payables" value={rupees(data?.payablePaise)} note="Owed by the shop" />
        <Metric label="Units in stock" value={count(data?.unitsInStock)} note="Serial-numbered units" />
        <Metric label="Active products" value={count(data?.activeProducts)} note={data ? `${data.activeParties} active parties` : undefined} />
      </div>

      <div className="grid divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-3 md:divide-x md:divide-y-0">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="group p-6 transition hover:bg-slate-50">
            <p className="font-medium text-slate-900">
              {a.label} <span className="inline-block transition group-hover:translate-x-0.5">→</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">{a.hint}</p>
          </Link>
        ))}
      </div>

      <p className="text-sm text-slate-500">
        Sales, purchase, receipts, reports and financial statements are added module by module. Menu items marked
        "Soon" are planned.
      </p>
    </div>
  );
}
