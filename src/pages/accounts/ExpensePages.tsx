import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatDate, todayIst } from "../../../shared/gst";
import { HOME_STATE_CODE } from "../../../shared/india";
import { computeExpense, type ExpenseDetail, type ExpenseStatus, type ExpenseSummary, type Ledger } from "../../../shared/ledgers";
import type { GstSlab, ListResponse } from "../../../shared/masters";
import { formatPaise, formatRate, parseRupees } from "../../../shared/money";
import { MODE_LABEL, MODES, type PaymentMode } from "../../../shared/vouchers";
import { Alert, Badge, Button, Card, CheckboxField, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import { CancelBox } from "../purchases/PurchaseDetailPage";

const STATUS_BADGE: Record<ExpenseStatus, { tone: "amber" | "green" | "red" | "slate"; label: string }> = {
  draft: { tone: "amber", label: "Awaiting approval" },
  approved: { tone: "green", label: "Approved" },
  rejected: { tone: "slate", label: "Rejected" },
  cancelled: { tone: "red", label: "Cancelled" },
};
const StatusBadge = ({ s }: { s: ExpenseStatus }) => <Badge tone={STATUS_BADGE[s].tone}>{STATUS_BADGE[s].label}</Badge>;

function ExpenseTable({ items, loading }: { items: ExpenseSummary[] | undefined; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="erp-table-wrap">
      <table className="erp-table min-w-full text-sm">
        <thead className="erp-thead text-left">
          <tr><th className="px-4 py-3">Voucher no.</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Expense heads</th><th className="px-4 py-3">Paid by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Amount ₹</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && !items && <tr><td colSpan={6} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
          {items?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No vouchers.</td></tr>}
          {items?.map((v) => (
            <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/expenses/${v.id}`)}>
              <td className="px-4 py-3 font-mono font-medium">{v.voucherNo ?? <span className="text-slate-400">Draft</span>}</td>
              <td className="px-4 py-3 tabular-nums">{formatDate(v.voucherDate)}</td>
              <td className="px-4 py-3">{v.heads}</td>
              <td className="px-4 py-3">{MODE_LABEL[v.mode]}</td>
              <td className="px-4 py-3"><StatusBadge s={v.status} /></td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPaise(v.totalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExpensesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useFetch<ListResponse<ExpenseSummary>>(`/expenses?${new URLSearchParams({ q, status, page: String(page) })}`);
  return (
    <div>
      <PageHeader title="Vouchers" subtitle="Shop expenses such as rent, salary and electricity. They count in the accounts once approved." actions={<Link to="/expenses/new"><Button>New voucher</Button></Link>} />
      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr]">
        <TextField label="" aria-label="Search" placeholder="Voucher no., head, narration or reference" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <SelectField label="" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">All</option>
          <option value="draft">Awaiting approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </SelectField>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <ExpenseTable items={data?.items} loading={loading} />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

export function ExpenseApprovalPage() {
  const { data, error, loading } = useFetch<ListResponse<ExpenseSummary>>("/expenses?status=draft");
  const total = data?.items.reduce((s, v) => s + v.totalPaise, 0) ?? 0;
  return (
    <div>
      <PageHeader title="Voucher Approval" subtitle={data ? `${data.total} waiting · ₹${formatPaise(total)}. Open a voucher to approve or reject it.` : "Drafts waiting for the owner."} />
      {error && <Alert tone="error">{error}</Alert>}
      <ExpenseTable items={data?.items} loading={loading} />
    </div>
  );
}

interface LineState {
  key: string;
  ledgerId: number;
  amount: string;
  gstRateBp: number;
  narration: string;
}
const newLine = (): LineState => ({ key: crypto.randomUUID(), ledgerId: 0, amount: "", gstRateBp: 0, narration: "" });

function ExpenseForm({ existing, heads, slabs }: { existing: ExpenseDetail | null; heads: Ledger[]; slabs: GstSlab[] }) {
  const navigate = useNavigate();
  const [uid] = useState(() => crypto.randomUUID());
  const [voucherDate, setVoucherDate] = useState(existing?.voucherDate ?? todayIst());
  const [mode, setMode] = useState<PaymentMode>(existing?.mode ?? "cash");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [lines, setLines] = useState<LineState[]>(
    existing
      ? existing.lines.map((l) => ({ key: crypto.randomUUID(), ledgerId: l.ledgerId, amount: (l.amountPaise / 100).toFixed(2), gstRateBp: l.gstRateBp, narration: l.narration }))
      : [newLine()],
  );
  // GST is off by default: most expenses (rent, transport) carry no GST.
  const [gstBill, setGstBill] = useState(existing?.gstBill ?? false);
  const [supplierName, setSupplierName] = useState(existing?.supplierName ?? "");
  const [supplierGstin, setSupplierGstin] = useState(existing?.supplierGstin ?? "");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(existing?.supplierInvoiceNo ?? "");
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(existing?.supplierInvoiceDate ?? todayIst());
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Preview only; the server recomputes. Interstate is decided by the GSTIN's state.
  const interstate = gstBill && supplierGstin.length >= 2 && supplierGstin.slice(0, 2) !== HOME_STATE_CODE;
  const totals = computeExpense(lines.map((l) => ({ amountPaise: parseRupees(l.amount || "0") ?? 0, gstRateBp: gstBill ? l.gstRateBp : 0 })), interstate);
  const total = totals.totalPaise;
  const update = (key: string, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: Record<string, string[]> = {};
    for (const l of lines) {
      const amt = parseRupees(l.amount);
      if (!l.ledgerId) next[`line-${l.key}`] = ["Choose an expense head"];
      else if (!amt) next[`line-${l.key}`] = ["Enter an amount"];
    }
    if (mode === "cheque" && !reference.trim()) next.reference = ["Enter the cheque number"];
    setErrors(next);
    if (Object.keys(next).length) return setFormError("Please fix the highlighted fields.");
    setSaving(true);
    const body = {
      uid: existing ? undefined : uid,
      voucherDate,
      mode,
      reference,
      remarks,
      gstBill,
      ...(gstBill ? { supplierName, supplierGstin, supplierInvoiceNo, supplierInvoiceDate } : {}),
      lines: lines.map((l) => ({ ledgerId: l.ledgerId, amountPaise: parseRupees(l.amount), gstRateBp: gstBill ? l.gstRateBp : 0, narration: l.narration })),
    };
    try {
      const v = existing
        ? await api<ExpenseDetail>(`/expenses/${existing.id}`, { method: "PUT", body: { ...body, uid: crypto.randomUUID(), updatedAt: existing.updatedAt } })
        : await api<ExpenseDetail>("/expenses", { method: "POST", body });
      navigate(`/expenses/${v.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError && <Alert tone="error">{formError}</Alert>}
      <Card className="grid gap-4 p-5 md:grid-cols-4">
        <TextField label="Date" type="date" max={todayIst()} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} errors={errors.voucherDate} />
        <SelectField label="Paid by" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
          {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </SelectField>
        <TextField label={mode === "cheque" ? "Cheque no." : "Reference"} value={reference} onChange={(e) => setReference(e.target.value)} errors={errors.reference} />
        <TextField label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Card>
      <Card className="space-y-4 p-5">
        <CheckboxField
          label="GST bill (claim input tax credit)"
          description="Turn on only when the bill charges GST and shows the supplier's GSTIN, e.g. a GST-registered landlord."
          checked={gstBill}
          onChange={setGstBill}
        />
        {gstBill && (
          <div className="grid gap-4 md:grid-cols-4">
            <TextField label="Supplier name" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} errors={errors.supplierName} />
            <TextField label="Supplier GSTIN" value={supplierGstin} onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())} errors={errors.supplierGstin} hint={interstate ? "Other state → IGST" : "Tamil Nadu → CGST + SGST"} />
            <TextField label="Bill no." value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} errors={errors.supplierInvoiceNo} />
            <TextField label="Bill date" type="date" max={voucherDate} value={supplierInvoiceDate} onChange={(e) => setSupplierInvoiceDate(e.target.value)} errors={errors.supplierInvoiceDate} />
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Expenses</h2>
        {heads.length === 0 && <Alert tone="info">No active expense heads. Add one under <Link className="underline" to="/ledgers">Ledgers</Link>.</Alert>}
        {lines.map((l) => (
          <div key={l.key} className={`grid items-start gap-3 ${gstBill ? "md:grid-cols-[2fr_1fr_1fr_2fr_auto]" : "md:grid-cols-[2fr_1fr_2fr_auto]"}`}>
            <SelectField label="" aria-label="Expense head" value={l.ledgerId} onChange={(e) => update(l.key, { ledgerId: Number(e.target.value) })} errors={errors[`line-${l.key}`]}>
              <option value={0}>Choose expense head…</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </SelectField>
            <TextField label="" aria-label="Amount" placeholder={gstBill ? "Amount before GST ₹" : "Amount ₹"} inputMode="decimal" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} />
            {gstBill && (
              <SelectField label="" aria-label="GST rate" value={l.gstRateBp} onChange={(e) => update(l.key, { gstRateBp: Number(e.target.value) })}>
                {[...new Set([0, ...slabs.filter((g) => g.isActive || g.rateBp === l.gstRateBp).map((g) => g.rateBp)])].sort((a, b) => a - b).map((r) => (
                  <option key={r} value={r}>GST {formatRate(r)}</option>
                ))}
              </SelectField>
            )}
            <TextField label="" aria-label="Narration" placeholder="Narration (optional)" value={l.narration} onChange={(e) => update(l.key, { narration: e.target.value })} />
            <Button type="button" variant="secondary" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
          </div>
        ))}
        {errors.lines && <p className="text-sm text-red-700">{errors.lines[0]}</p>}
        <div className="flex items-center justify-between">
          <Button type="button" variant="secondary" disabled={lines.length >= 20} onClick={() => setLines((ls) => [...ls, newLine()])}>Add line</Button>
          <div className="text-right text-sm tabular-nums">
            {gstBill && totals.cgstPaise + totals.sgstPaise + totals.igstPaise > 0 && (
              <p className="text-slate-600">
                Taxable ₹{formatPaise(totals.taxablePaise)} ·{" "}
                {interstate ? `IGST ₹${formatPaise(totals.igstPaise)}` : `CGST ₹${formatPaise(totals.cgstPaise)} · SGST ₹${formatPaise(totals.sgstPaise)}`}
              </p>
            )}
            <p className="font-semibold">Total ₹{formatPaise(total)}</p>
          </div>
        </div>
      </Card>
      <div className="flex items-center justify-end gap-3">
        <p className="text-sm text-slate-500">Saved as a draft. It counts in the accounts only after approval.</p>
        <Button type="submit" loading={saving}>{existing ? "Save changes" : "Save draft"}</Button>
      </div>
    </form>
  );
}

export function ExpenseFormPage() {
  const { id } = useParams();
  const heads = useFetch<ListResponse<Ledger>>("/ledgers?nature=expense&active=1");
  const slabs = useFetch<{ items: GstSlab[] }>("/gst-slabs");
  const existing = useFetch<ExpenseDetail>(id ? `/expenses/${id}` : null);
  if (heads.error || existing.error) return <Alert tone="error">{heads.error ?? existing.error}</Alert>;
  if (!heads.data || !slabs.data || (id && !existing.data)) return <Spinner />;
  if (existing.data && existing.data.status !== "draft") return <Alert tone="error">Only drafts can be edited.</Alert>;
  return (
    <div>
      <PageHeader title={id ? "Edit draft voucher" : "New voucher"} subtitle={<Link to="/expenses" className="text-slate-600 hover:underline">← All vouchers</Link>} />
      <ExpenseForm existing={existing.data} heads={heads.data.items.filter((h) => !h.isSystem)} slabs={slabs.data.items} />
    </div>
  );
}

function RejectBox({ onReject }: { onReject: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Reject</Button>;
  return (
    <div className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="danger" loading={busy} onClick={async () => {
          setBusy(true);
          try { await onReject(reason); } catch (err) { setError(err instanceof ApiError ? err.message : "Could not reject."); setBusy(false); }
        }}>Confirm reject</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Back</Button>
      </div>
    </div>
  );
}

export function ExpenseDetailPage() {
  const { id } = useParams();
  const { data: v, error, reload } = useFetch<ExpenseDetail>(`/expenses/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!v) return <Spinner />;
  const approve = async () => {
    setApproving(true);
    setActionError(null);
    try {
      await api(`/expenses/${v.id}/approve`, { method: "POST", body: { updatedAt: v.updatedAt } });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setApproving(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title={v.voucherNo ? `Voucher ${v.voucherNo}` : "Draft voucher"} subtitle={<Link to="/expenses" className="text-slate-600 hover:underline">← All vouchers</Link>} actions={<StatusBadge s={v.status} />} />
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {v.statusReason && <Alert tone="error">{v.status === "rejected" ? "Rejected" : "Cancelled"}: {v.statusReason}</Alert>}
      <Card className="grid gap-4 p-5 text-sm md:grid-cols-4">
        <div><p className="text-slate-500">Date</p><p className="font-medium">{formatDate(v.voucherDate)}</p></div>
        <div><p className="text-slate-500">Paid by</p><p className="font-medium">{MODE_LABEL[v.mode]}{v.reference && ` · ${v.reference}`}</p></div>
        <div><p className="text-slate-500">Total</p><p className="text-lg font-semibold tabular-nums">₹{formatPaise(v.totalPaise)}</p></div>
        {v.remarks && <div><p className="text-slate-500">Remarks</p><p>{v.remarks}</p></div>}
        {v.gstBill && (
          <div className="md:col-span-4">
            <p className="text-slate-500">GST bill</p>
            <p>{v.supplierName} · {v.supplierGstin} · Bill {v.supplierInvoiceNo} dated {v.supplierInvoiceDate ? formatDate(v.supplierInvoiceDate) : ""}</p>
            <p className="text-slate-600">Taxable ₹{formatPaise(v.taxablePaise)} · {v.interstate ? `IGST ₹${formatPaise(v.igstPaise)}` : `CGST ₹${formatPaise(v.cgstPaise)} · SGST ₹${formatPaise(v.sgstPaise)}`}</p>
          </div>
        )}
      </Card>
      <Card className="p-5">
        <table className="erp-table min-w-full text-sm">
          <thead className="erp-thead text-left">
            <tr><th className="py-1">Expense head</th><th className="py-1">Narration</th>{v.gstBill && <th className="py-1 text-right">GST</th>}<th className="py-1 text-right">Amount ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {v.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2">{l.ledgerName}</td>
                <td className="py-2 text-slate-600">{l.narration}</td>
                {v.gstBill && <td className="py-2 text-right tabular-nums">{formatRate(l.gstRateBp)} · ₹{formatPaise(l.taxPaise)}</td>}
                <td className="py-2 text-right tabular-nums">{formatPaise(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {v.journal.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Accounting entry</h2>
          <table className="erp-table min-w-full text-sm">
            <tbody>{v.journal.map((j, i) => <tr key={i}><td className="py-1">{j.account}</td><td className="py-1 text-right tabular-nums">{j.debitPaise ? `${formatPaise(j.debitPaise)} Dr` : ""}</td><td className="py-1 text-right tabular-nums">{j.creditPaise ? `${formatPaise(j.creditPaise)} Cr` : ""}</td></tr>)}</tbody>
          </table>
        </Card>
      )}
      {v.status === "draft" && (
        <div className="flex flex-wrap gap-2">
          <Button loading={approving} onClick={approve}>Approve and post</Button>
          <Link to={`/expenses/${v.id}/edit`}><Button variant="secondary">Edit</Button></Link>
          <RejectBox onReject={async (reason) => { await api(`/expenses/${v.id}/reject`, { method: "POST", body: { reason, updatedAt: v.updatedAt } }); reload(); }} />
        </div>
      )}
      {v.status === "approved" && (
        <CancelBox label="Cancel this voucher" onCancel={async (reason) => { await api(`/expenses/${v.id}/cancel`, { method: "POST", body: { reason } }); reload(); }} />
      )}
    </div>
  );
}
