import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { BalanceSheet, BsGroup, LedgerReport, PlLine, ProfitAndLoss, TrialBalance } from "../../../shared/financials";
import { formatDate, todayIst } from "../../../shared/gst";
import type { Ledger } from "../../../shared/ledgers";
import type { ListResponse } from "../../../shared/masters";
import { formatPaise } from "../../../shared/money";
import { financialYear } from "../../../shared/sales";
import { Alert, Button, Card, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

const fyStart = () => `20${financialYear(todayIst()).slice(0, 2)}-04-01`;
const drCr = (p: number) => (p === 0 ? "0.00" : `${formatPaise(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);
const money = (p: number) => (p < 0 ? `(${formatPaise(-p)})` : formatPaise(p));
const PrintButton = () => <Button variant="secondary" onClick={() => window.print()}>Print</Button>;

function AsOf({ to, setTo }: { to: string; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <TextField label="As on" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

export function TrialBalancePage() {
  const [to, setTo] = useState(todayIst());
  const { data, error, loading } = useFetch<TrialBalance>(`/financials/trial-balance?to=${to}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Trial Balance" subtitle={`All account balances as on ${formatDate(to)}.`} actions={<PrintButton />} />
      <AsOf to={to} setTo={setTo} />
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Group</th><th className="px-4 py-3 text-right">Debit ₹</th><th className="px-4 py-3 text-right">Credit ₹</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...data.rows.map((r) => ({ key: r.key, name: r.name, group: r.groupName, v: r.balancePaise })),
                { key: "os", name: "Opening Stock", group: "Stock-in-Hand", v: data.openingStockPaise },
                { key: "od", name: "Difference in opening balances", group: "Capital Account", v: data.openingDifferencePaise }]
                .filter((r) => r.v !== 0)
                .map((r) => (
                  <tr key={r.key}>
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2 text-slate-500">{r.group}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.v > 0 ? formatPaise(r.v) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.v < 0 ? formatPaise(-r.v) : ""}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 font-semibold">
              <tr><td className="px-4 py-3" colSpan={2}>Total</td><td className="px-4 py-3 text-right tabular-nums">{formatPaise(data.totalDebitPaise)}</td><td className="px-4 py-3 text-right tabular-nums">{formatPaise(data.totalCreditPaise)}</td></tr>
            </tfoot>
          </table>
          {data.totalDebitPaise !== data.totalCreditPaise && <Alert tone="error">Debit and credit totals differ — please report this.</Alert>}
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, bold, indent }: { label: ReactNode; value: number; bold?: boolean | undefined; indent?: boolean | undefined }) => (
  <div className={`flex justify-between py-1.5 ${bold ? "font-semibold" : ""} ${indent ? "pl-4 text-slate-600" : ""}`}>
    <span>{label}</span>
    <span className="tabular-nums">{money(value)}</span>
  </div>
);
const Lines = ({ lines }: { lines: PlLine[] }) => <>{lines.map((l) => <Row key={l.name} label={l.name} value={l.amountPaise} indent />)}</>;
const sum = (l: PlLine[]) => l.reduce((s, x) => s + x.amountPaise, 0);

export function ProfitLossPage() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIst());
  const { data, error, loading } = useFetch<ProfitAndLoss>(`/financials/profit-loss?from=${from}&to=${to}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Profit & Loss" subtitle={`${formatDate(from)} to ${formatDate(to)} · stock at weighted-average cost (excl. GST)`} actions={<PrintButton />} />
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="divide-y divide-slate-100 p-5 text-sm">
            <h2 className="pb-2 text-sm font-semibold">Trading account</h2>
            <div className="py-2">
              <Row label="Sales" value={data.salesPaise} />
              <Row label="Less: Sales returns" value={-data.salesReturnsPaise} indent />
              <Row label="Net sales" value={data.salesPaise - data.salesReturnsPaise} bold />
            </div>
            <div className="py-2">
              <Row label="Opening stock" value={data.openingStockPaise} />
              <Row label="Add: Purchases" value={data.purchasesPaise} indent />
              <Row label="Less: Purchase returns" value={-data.purchaseReturnsPaise} indent />
              <Lines lines={data.directExpenses} />
              <Row label="Less: Closing stock" value={-data.closingStockPaise} indent />
              <Row label="Cost of goods sold" value={data.openingStockPaise + data.purchasesPaise - data.purchaseReturnsPaise + sum(data.directExpenses) - data.closingStockPaise} bold />
            </div>
            <div className="pt-2"><Row label={data.grossProfitPaise >= 0 ? "Gross profit" : "Gross loss"} value={data.grossProfitPaise} bold /></div>
          </Card>
          <Card className="divide-y divide-slate-100 p-5 text-sm">
            <h2 className="pb-2 text-sm font-semibold">Profit & loss account</h2>
            <div className="py-2"><Row label="Gross profit" value={data.grossProfitPaise} /></div>
            <div className="py-2">
              <Row label="Add: Other income" value={sum(data.indirectIncomes)} />
              <Lines lines={data.indirectIncomes} />
            </div>
            <div className="py-2">
              <Row label="Less: Expenses" value={-sum(data.indirectExpenses)} />
              <Lines lines={data.indirectExpenses} />
            </div>
            <div className="pt-3">
              <div className={`flex justify-between rounded-lg px-3 py-2 text-base font-semibold ${data.netProfitPaise >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                <span>{data.netProfitPaise >= 0 ? "Net profit" : "Net loss"}</span>
                <span className="tabular-nums">₹{formatPaise(Math.abs(data.netProfitPaise))}</span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Side({ title, groups, total }: { title: string; groups: BsGroup[]; total: number }) {
  return (
    <Card className="flex flex-col p-5 text-sm">
      <h2 className="pb-2 text-sm font-semibold">{title}</h2>
      <div className="flex-1 divide-y divide-slate-100">
        {groups.map((g) => (
          <div key={g.name} className="py-2">
            <Row label={g.name} value={g.amountPaise} bold />
            {g.items.length > 1 || g.items[0]?.name !== g.name ? <Lines lines={g.items} /> : null}
          </div>
        ))}
      </div>
      <div className="mt-2 border-t-2 border-slate-200 pt-2"><Row label="Total" value={total} bold /></div>
    </Card>
  );
}

export function BalanceSheetPage() {
  const [to, setTo] = useState(todayIst());
  const { data, error, loading } = useFetch<BalanceSheet>(`/financials/balance-sheet?to=${to}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Balance Sheet" subtitle={`As on ${formatDate(to)}`} actions={<PrintButton />} />
      <AsOf to={to} setTo={setTo} />
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <>
          {data.totalAssetsPaise !== data.totalLiabilitiesPaise && <Alert tone="error">The two sides differ — please report this.</Alert>}
          <div className="grid gap-5 lg:grid-cols-2">
            <Side title="Capital & Liabilities" groups={data.liabilities} total={data.totalLiabilitiesPaise} />
            <Side title="Assets" groups={data.assets} total={data.totalAssetsPaise} />
          </div>
          <p className="text-xs text-slate-500">Profit is cumulative up to this date. “Difference in opening balances” is the net of all go-live opening balances and opening stock; set Capital and Cash/Bank openings under Ledgers to clear it.</p>
        </>
      )}
    </div>
  );
}

export function LedgerReportPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get("ledger") ?? "";
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIst());
  const ledgers = useFetch<ListResponse<Ledger>>("/ledgers");
  const { data, error, loading } = useFetch<LedgerReport>(id ? `/financials/ledger/${id}?from=${from}&to=${to}` : null);
  return (
    <div className="space-y-5">
      <PageHeader title="Ledger Report" subtitle="Every entry in one account with its running balance. For customers and suppliers use Statement of Account." actions={data && <PrintButton />} />
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <SelectField label="Ledger" value={id} onChange={(e) => setParams(e.target.value ? { ledger: e.target.value } : {})}>
          <option value="">Choose…</option>
          {ledgers.data?.items.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.groupName}</option>)}
        </SelectField>
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {id && loading && !data && <Spinner />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Doc no.</th><th className="px-4 py-3">Narration</th><th className="px-4 py-3 text-right">Debit ₹</th><th className="px-4 py-3 text-right">Credit ₹</th><th className="px-4 py-3 text-right">Balance ₹</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/50"><td className="px-4 py-2" colSpan={6}>Opening balance</td><td className="px-4 py-2 text-right tabular-nums">{drCr(data.openingPaise)}</td></tr>
              {data.lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 tabular-nums">{formatDate(l.date)}</td>
                  <td className="px-4 py-2">{l.docType}</td>
                  <td className="px-4 py-2 font-mono">{l.docNo}</td>
                  <td className="px-4 py-2 text-slate-600">{l.narration}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.debitPaise ? formatPaise(l.debitPaise) : ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.creditPaise ? formatPaise(l.creditPaise) : ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{drCr(l.balancePaise)}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="px-4 py-3" colSpan={6}>Closing balance</td><td className="px-4 py-3 text-right tabular-nums">{drCr(data.closingPaise)}</td></tr>
            </tbody>
          </table>
          {data.truncated && <p className="p-3 text-sm text-amber-700">Showing the first 5000 entries; narrow the dates to see the rest.</p>}
        </div>
      )}
    </div>
  );
}
