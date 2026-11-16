import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { formatDate, todayIst } from "../../../shared/gst";
import type { Party } from "../../../shared/masters";
import { formatPaise } from "../../../shared/money";
import type { OutstandingParty, Statement, VoucherKind } from "../../../shared/vouchers";
import { SearchPicker } from "../../components/SearchPicker";
import { Alert, Badge, Button, Card, PageHeader, Spinner, TextField } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

/** Debit balance = party owes the shop (Dr); credit = shop owes the party (Cr). */
const drCr = (paise: number) => (paise === 0 ? "0.00" : `${formatPaise(Math.abs(paise))} ${paise > 0 ? "Dr" : "Cr"}`);

function Ageing({ rows }: { rows: { bucket: string; amountPaise: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-4">
      {rows.map((r) => (
        <div key={r.bucket} className="bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{r.bucket}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">₹{formatPaise(r.amountPaise)}</p>
        </div>
      ))}
    </div>
  );
}

export function StatementPage() {
  const [params, setParams] = useSearchParams();
  const partyId = params.get("party");
  const [picked, setPicked] = useState<Party | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayIst());
  const q = new URLSearchParams({ to });
  if (from) q.set("from", from);
  const { data, error, loading } = useFetch<Statement>(partyId ? `/accounts/parties/${partyId}/statement?${q}` : null);
  const choose = (p: Party | null) => {
    setPicked(p);
    setParams(p ? { party: String(p.id) } : {});
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Statement of Account" subtitle="Party ledger with running balance and pending bills." actions={data && <Button variant="secondary" onClick={() => window.print()}>Print</Button>} />
      <div className="grid gap-3 print:hidden md:grid-cols-[2fr_1fr_1fr]">
        <SearchPicker<Party>
          label="Party"
          path="/parties"
          selected={picked ?? (data ? ({ id: data.party.id, name: data.party.name } as Party) : null)}
          onSelect={choose}
          render={(p) => ({ title: p.name, subtitle: p.phone })}
        />
        <TextField label="From" type="date" value={from || data?.from || ""} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {partyId && loading && !data && <Spinner />}
      {data && (
        <>
          <div>
            <h2 className="text-lg font-semibold">{data.party.name}</h2>
            <p className="text-sm text-slate-500">{[data.party.gstin, data.party.phone].filter(Boolean).join(" · ")} · {formatDate(data.from)} to {formatDate(data.to)}</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Doc no.</th><th className="px-4 py-3 text-right">Debit ₹</th><th className="px-4 py-3 text-right">Credit ₹</th><th className="px-4 py-3 text-right">Balance ₹</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50/50"><td className="px-4 py-2" colSpan={5}>Opening balance</td><td className="px-4 py-2 text-right tabular-nums">{drCr(data.openingPaise)}</td></tr>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 tabular-nums">{formatDate(l.date)}</td>
                    <td className="px-4 py-2">{l.docType}</td>
                    <td className="px-4 py-2 font-mono">{l.docNo}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.debitPaise ? formatPaise(l.debitPaise) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.creditPaise ? formatPaise(l.creditPaise) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{drCr(l.balancePaise)}</td>
                  </tr>
                ))}
                <tr className="font-semibold"><td className="px-4 py-3" colSpan={5}>Closing balance</td><td className="px-4 py-3 text-right tabular-nums">{drCr(data.closingPaise)}</td></tr>
              </tbody>
            </table>
          </div>
          <h2 className="text-sm font-semibold">Pending bills (as of today)</h2>
          <Ageing rows={data.ageing} />
          {data.outstanding.length > 0 && (
            <Card className="overflow-x-auto p-0">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr><th className="px-4 py-3">Bill</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Days pending</th><th className="px-4 py-3 text-right">Bill ₹</th><th className="px-4 py-3 text-right">Pending ₹</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.outstanding.map((b) => (
                    <tr key={`${b.targetType}:${b.targetId}`}>
                      <td className="px-4 py-2 font-mono">{b.docNo}</td>
                      <td className="px-4 py-2 tabular-nums">{formatDate(b.docDate)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatDate(b.dueDate)}</td>
                      <td className="px-4 py-2">{b.daysPending} {b.overdue && b.targetType === "sale" && <Badge tone="red">Overdue</Badge>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatPaise(b.billAmountPaise)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatPaise(b.outstandingPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export function OutstandingPage() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<VoucherKind>("receipt");
  const { data, error, loading } = useFetch<{ items: OutstandingParty[]; totalPaise: number; ageing: { bucket: string; amountPaise: number }[] }>(`/outstanding?kind=${kind}`);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Outstanding"
        subtitle="Who owes you, who you owe, and for how long."
        actions={<Link to={kind === "receipt" ? "/receipts/new" : "/payments/new"}><Button>{kind === "receipt" ? "New receipt" : "New payment"}</Button></Link>}
      />
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(["receipt", "payment"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 font-medium ${kind === k ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>
            {k === "receipt" ? "Receivable (customers)" : "Payable (suppliers)"}
          </button>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data && <Ageing rows={data.ageing} />}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr><th className="px-4 py-3">Party</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Oldest bill</th><th className="px-4 py-3 text-right">Overdue ₹</th><th className="px-4 py-3 text-right">Balance ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && <tr><td colSpan={5} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
            {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Nothing outstanding.</td></tr>}
            {data?.items.map((p) => (
              <tr key={p.partyId} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/statement?party=${p.partyId}`)}>
                <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                <td className="px-4 py-3">{p.phone}</td>
                <td className="px-4 py-3">{p.oldestDays === null ? <span className="text-slate-400">On account</span> : <>{p.oldestDays} days {p.oldestDays > 90 && <Badge tone="red">90+</Badge>}</>}</td>
                <td className="px-4 py-3 text-right tabular-nums">{p.overduePaise ? formatPaise(p.overduePaise) : ""}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(p.balancePaise)}</td>
              </tr>
            ))}
          </tbody>
          {data && data.items.length > 0 && (
            <tfoot><tr className="font-semibold"><td className="px-4 py-3" colSpan={4}>Total</td><td className="px-4 py-3 text-right tabular-nums">{formatPaise(data.totalPaise)}</td></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
