import { useState } from "react";
import { Link } from "react-router";
import type { ProductGroup } from "../../../shared/catalog";
import { todayIst } from "../../../shared/gst";
import { formatPaise } from "../../../shared/money";
import { financialYear } from "../../../shared/sales";
import type { NamedAmount, SalesStats, StockReport } from "../../../shared/stats";
import { BarChart, monthLabel } from "../../components/BarChart";
import { Alert, Badge, Button, Card, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

const fyStart = () => `20${financialYear(todayIst()).slice(0, 2)}-04-01`;

function Ranking({ title, items, linkTo }: { title: string; items: NamedAmount[]; linkTo?: (i: NamedAmount) => string }) {
  const max = Math.max(1, ...items.map((i) => i.taxablePaise));
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {items.length === 0 && <p className="text-sm text-slate-500">No sales in this period.</p>}
      <ol className="space-y-2.5 text-sm">
        {items.map((i, n) => (
          <li key={`${i.id ?? i.name}`}>
            <div className="flex justify-between gap-3">
              <span className="truncate">
                <span className="mr-2 text-slate-400">{n + 1}</span>
                {linkTo && i.id ? <Link className="hover:underline" to={linkTo(i)}>{i.name}</Link> : i.name}
              </span>
              <span className="shrink-0 tabular-nums">₹{formatPaise(i.taxablePaise)} <span className="text-slate-400">· {i.quantity}</span></span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-slate-700" style={{ width: `${Math.max(2, (i.taxablePaise / max) * 100)}%` }} /></div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function SalesStatsPage() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIst());
  const { data, error, loading } = useFetch<SalesStats>(`/stats/sales?from=${from}&to=${to}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Sales Statistics" subtitle="Net of returns; cancelled bills excluded. Rankings by value before GST." />
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
            {[["Net sales (incl. GST)", `₹${formatPaise(data.salesTotalPaise)}`], ["Invoices", String(data.invoices)], ["Average bill", `₹${formatPaise(data.averageBillPaise)}`]].map(([l, v]) => (
              <div key={l} className="bg-white p-5"><p className="text-xs uppercase tracking-wide text-slate-500">{l}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{v}</p></div>
            ))}
          </div>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Month by month</h2>
            <BarChart
              labels={data.months.map((m) => monthLabel(m.month))}
              series={[
                { name: "Sales", className: "fill-slate-800", values: data.months.map((m) => m.salesPaise) },
                { name: "Purchases", className: "fill-slate-300", values: data.months.map((m) => m.purchasesPaise) },
              ]}
            />
          </Card>
          <div className="grid gap-5 lg:grid-cols-3">
            <Ranking title="Top products" items={data.topProducts} linkTo={(i) => `/products/${i.id}`} />
            <Ranking title="Top customers" items={data.topCustomers} linkTo={(i) => `/statement?party=${i.id}`} />
            <Ranking title="By product group" items={data.byGroup} />
          </div>
        </>
      )}
    </div>
  );
}

export function StockReportPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [show, setShow] = useState("all");
  const groups = useFetch<{ items: ProductGroup[] }>("/product-groups");
  const { data, error, loading } = useFetch<StockReport>(`/stock-report?${new URLSearchParams({ q, group, show })}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Stock Report" subtitle="Quantity in hand and value at average purchase cost (excl. GST)." actions={data && <Button variant="secondary" onClick={() => window.print()}>Print</Button>} />
      <div className="grid gap-3 print:hidden md:grid-cols-[2fr_1fr_1fr]">
        <TextField label="" aria-label="Search" placeholder="Product, brand or HSN" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="" aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {groups.data?.items.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
        </SelectField>
        <SelectField label="" aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="all">All products</option>
          <option value="in">In stock</option>
          <option value="low">Low stock (2 or fewer)</option>
          <option value="out">Out of stock</option>
        </SelectField>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Group</th><th className="px-4 py-3 text-right">In stock</th><th className="px-4 py-3 text-right">Avg cost ₹</th><th className="px-4 py-3 text-right">Value ₹</th><th className="px-4 py-3 text-right">At selling price ₹</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No products match.</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.productId}>
                  <td className="px-4 py-2"><Link className="hover:underline" to={`/products/${r.productId}`}>{r.brand} {r.name}</Link> {!r.isActive && <Badge tone="red">Inactive</Badge>}</td>
                  <td className="px-4 py-2 text-slate-500">{r.group}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.quantity <= 0 ? <Badge tone="red">Out</Badge> : r.quantity <= 2 ? <Badge tone="amber">{r.quantity} {r.unit}</Badge> : `${r.quantity} ${r.unit}`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.averageCostPaise ? formatPaise(r.averageCostPaise) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPaise(r.valuePaise)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPaise(r.sellingValuePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 font-semibold">
              <tr><td className="px-4 py-3" colSpan={2}>Total</td><td className="px-4 py-3 text-right tabular-nums">{data.totalQuantity}</td><td /><td className="px-4 py-3 text-right tabular-nums">{formatPaise(data.totalValuePaise)}</td><td className="px-4 py-3 text-right tabular-nums">{formatPaise(data.totalSellingValuePaise)}</td></tr>
            </tfoot>
          </table>
          {data.truncated && <p className="p-3 text-sm text-amber-700">Showing the first 5000 products; totals cover all.</p>}
        </div>
      )}
    </div>
  );
}
