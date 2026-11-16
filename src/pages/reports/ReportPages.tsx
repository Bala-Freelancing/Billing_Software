import { useState } from "react";
import { useNavigate } from "react-router";
import { formatDate, todayIst } from "../../../shared/gst";
import type { GstSlab, ShopSettings } from "../../../shared/masters";
import { formatPaise, formatRate } from "../../../shared/money";
import type { GstReport, Register, Totals } from "../../../shared/reports";
import { financialYear } from "../../../shared/sales";
import { Alert, Badge, Button, Card, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

type Kind = "sales" | "purchase";
const monthStart = () => `${todayIst().slice(0, 8)}01`;
const fyStart = () => `20${financialYear(todayIst()).slice(0, 2)}-04-01`;

function prevMonth(): [string, string] {
  const [y, m] = todayIst().split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <TextField label="From" type="date" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <TextField label="To" type="date" value={to} onChange={(e) => onChange(from, e.target.value)} />
      <div className="flex gap-2 pb-0.5">
        <Button variant="secondary" onClick={() => onChange(monthStart(), todayIst())}>This month</Button>
        <Button variant="secondary" onClick={() => onChange(...prevMonth())}>Last month</Button>
        <Button variant="secondary" onClick={() => onChange(fyStart(), todayIst())}>This FY</Button>
      </div>
    </div>
  );
}

const Num = ({ v, bold }: { v: number; bold?: boolean | undefined }) => <td className={`px-3 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>{formatPaise(v)}</td>;
const TotalCells = ({ t, bold }: { t: Totals; bold?: boolean | undefined }) => (
  <>
    <Num v={t.taxablePaise} bold={bold} />
    <Num v={t.cgstPaise} bold={bold} />
    <Num v={t.sgstPaise} bold={bold} />
    <Num v={t.igstPaise} bold={bold} />
    <Num v={t.totalPaise} bold={bold} />
  </>
);
const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <th className={`px-3 py-2.5 ${right ? "text-right" : ""}`}>{children}</th>;
const theadClass = "bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600";

export function RegisterPage({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIst());
  const [status, setStatus] = useState("posted");
  const { data, error, loading } = useFetch<Register>(`/reports/register?${new URLSearchParams({ kind, from, to, status })}`);
  const open = (r: Register["rows"][number]) =>
    navigate(kind === "sales" ? (r.docType === "invoice" ? `/sales/${r.id}` : "/sales-returns") : r.docType === "invoice" ? `/purchases/${r.id}` : "/purchase-returns");
  return (
    <div className="space-y-5">
      <PageHeader title={kind === "sales" ? "Sales Report" : "Purchase Report"} subtitle={kind === "sales" ? "Invoices and credit notes for the period." : "Purchase bills and debit notes for the period."} actions={data && <Button variant="secondary" onClick={() => window.print()}>Print</Button>} />
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <RangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="posted">Posted</option>
          <option value="all">Include cancelled</option>
          <option value="cancelled">Cancelled only</option>
        </SelectField>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className={theadClass}>
              <tr><TH>Date</TH><TH>Doc no.</TH><TH>{kind === "sales" ? "Customer" : "Supplier"}</TH><TH>GSTIN</TH><TH right>Taxable</TH><TH right>CGST</TH><TH right>SGST</TH><TH right>IGST</TH><TH right>Total ₹</TH></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">Nothing in this period.</td></tr>}
              {data.rows.map((r) => (
                <tr key={`${r.docType}${r.id}`} className={`cursor-pointer hover:bg-slate-50 ${r.status === "cancelled" ? "text-slate-400 line-through" : ""}`} onClick={() => open(r)}>
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 font-mono">{r.docNo} {r.docType === "return" && <Badge tone="amber">{kind === "sales" ? "Credit note" : "Debit note"}</Badge>}</td>
                  <td className="px-3 py-2">{r.partyName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.gstin}</td>
                  <TotalCells t={r} />
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200">
              <tr><td colSpan={4} className="px-3 py-3 font-semibold">Net (posted invoices − returns)</td><TotalCells t={data.net} bold /></tr>
            </tfoot>
          </table>
          {data.truncated && <p className="p-3 text-sm text-amber-700">Showing the first 5000 documents; the net total covers all of them. Narrow the dates to see the rest.</p>}
        </div>
      )}
    </div>
  );
}

export function GstReportPage() {
  const [kind, setKind] = useState<Kind>("sales");
  const [[from, to], setRange] = useState(prevMonth());
  const [rates, setRates] = useState<number[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const slabs = useFetch<{ items: GstSlab[] }>("/gst-slabs");
  const q = new URLSearchParams({ kind, from, to, rates: rates.join(",") });
  const { data, error, loading } = useFetch<GstReport>(`/reports/gst?${q}`);
  const toggle = (r: number) => setRates((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r].sort((a, b) => a - b)));

  async function pdf() {
    if (!data) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const shop = await api<ShopSettings>("/settings");
      const { downloadGstPdf } = await import("../../lib/gstPdf");
      await downloadGstPdf(data, shop);
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : "Could not create the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="GST Slab Report" subtitle="For your auditor: GST by slab, B2B/B2C, HSN summary and every bill. Returns are netted in their own month." actions={<Button onClick={pdf} loading={pdfBusy} disabled={!data}>Download PDF</Button>} />
      <Card className="space-y-4 p-5">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {(["sales", "purchase"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 font-medium ${kind === k ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>
              {k === "sales" ? "Sales (output GST)" : "Purchases & expenses (input GST)"}
            </button>
          ))}
        </div>
        <RangePicker from={from} to={to} onChange={(f, t) => setRange([f, t])} />
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">GST slab <span className="font-normal text-slate-500">(none ticked = all)</span></p>
          <div className="flex flex-wrap gap-2">
            {[...new Set((slabs.data?.items ?? []).map((s) => s.rateBp))].sort((a, b) => a - b).map((r) => (
              <button key={r} type="button" onClick={() => toggle(r)} className={`rounded-full border px-3 py-1 text-sm ${rates.includes(r) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:border-slate-500"}`}>
                {formatRate(r)}
              </button>
            ))}
          </div>
        </div>
      </Card>
      {(error || pdfError) && <Alert tone="error">{error ?? pdfError}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className={theadClass}><tr><TH>GST rate</TH><TH right>Taxable</TH><TH right>CGST</TH><TH right>SGST</TH><TH right>IGST</TH><TH right>Value incl. GST</TH><TH right>Returns (taxable)</TH></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.slabs.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No bills in this period.</td></tr>}
                {data.slabs.map((s) => <tr key={s.rateBp}><td className="px-3 py-2 font-medium">{formatRate(s.rateBp)}</td><TotalCells t={s} /><Num v={s.returnTaxablePaise} /></tr>)}
              </tbody>
              <tfoot className="border-t-2 border-slate-200"><tr><td className="px-3 py-3 font-semibold">Total</td><TotalCells t={data.net} bold /><td /></tr></tfoot>
            </table>
          </div>
          {data.b2b && data.b2c && (
            <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-2">
              {[["B2B · registered buyers", data.b2b], ["B2C · consumers", data.b2c]].map(([label, t]) => (
                <div key={label as string} className="bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{label as string}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">₹{formatPaise((t as Totals).taxablePaise)} <span className="text-sm font-normal text-slate-500">taxable · tax ₹{formatPaise((t as Totals).cgstPaise + (t as Totals).sgstPaise + (t as Totals).igstPaise)}</span></p>
                </div>
              ))}
            </div>
          )}
          <h2 className="text-sm font-semibold">Bills ({data.rows.length}{data.truncated ? "+, first 5000 shown" : ""})</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className={theadClass}><tr><TH>Date</TH><TH>Doc no.</TH><TH>Party</TH><TH>GSTIN</TH><TH>Rate</TH><TH right>Taxable</TH><TH right>CGST</TH><TH right>SGST</TH><TH right>IGST</TH><TH right>Total</TH></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 tabular-nums">{formatDate(r.date)}</td>
                    <td className="px-3 py-2 font-mono">{r.docNo} {r.docType !== "invoice" && <Badge tone="amber">{r.docType === "expense" ? "Expense" : kind === "sales" ? "Credit note" : "Debit note"}</Badge>}</td>
                    <td className="px-3 py-2">{r.partyName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.gstin}</td>
                    <td className="px-3 py-2">{formatRate(r.rateBp)}</td>
                    <TotalCells t={r} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.hsn.length > 0 && (
            <>
              <h2 className="text-sm font-semibold">HSN summary</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className={theadClass}><tr><TH>HSN</TH><TH>Rate</TH><TH right>Qty</TH><TH right>Taxable</TH><TH right>CGST</TH><TH right>SGST</TH><TH right>IGST</TH><TH right>Total</TH></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.hsn.map((h) => <tr key={`${h.hsnCode}-${h.rateBp}`}><td className="px-3 py-2 font-mono">{h.hsnCode}</td><td className="px-3 py-2">{formatRate(h.rateBp)}</td><td className="px-3 py-2 text-right tabular-nums">{h.quantity}</td><TotalCells t={h} /></tr>)}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
