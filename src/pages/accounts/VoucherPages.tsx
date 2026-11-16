import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatDate, todayIst } from "../../../shared/gst";
import type { ListResponse, Party } from "../../../shared/masters";
import { formatPaise, parseRupees } from "../../../shared/money";
import { allocateOldestFirst, MODE_LABEL, MODES, type OutstandingBill, type PaymentMode, type VoucherDetail, type VoucherKind, type VoucherSummary } from "../../../shared/vouchers";
import { SearchPicker } from "../../components/SearchPicker";
import { Alert, Badge, Button, Card, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import { CancelBox } from "../purchases/PurchaseDetailPage";

const META: Record<VoucherKind, { title: string; plural: string; party: string; partyType: string; base: string; verb: string }> = {
  receipt: { title: "Receipt", plural: "Receipts", party: "Customer", partyType: "customer", base: "/receipts", verb: "Received from" },
  payment: { title: "Payment", plural: "Payments", party: "Supplier", partyType: "supplier", base: "/payments", verb: "Paid to" },
};
const keyOf = (b: { targetType: string; targetId: number }) => `${b.targetType}:${b.targetId}`;
const rupees = (paise: number) => (paise / 100).toFixed(2);

export function VouchersPage({ kind }: { kind: VoucherKind }) {
  const m = META[kind];
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("posted");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ kind, q, status, page: String(page) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { data, error, loading } = useFetch<ListResponse<VoucherSummary>>(`/vouchers?${params}`);
  const reset = () => setPage(1);
  return (
    <div>
      <PageHeader
        title={m.plural}
        subtitle={kind === "receipt" ? "Money received from customers." : "Money paid to suppliers."}
        actions={<Link to={`${m.base}/new`}><Button>New {m.title.toLowerCase()}</Button></Link>}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <TextField label="" aria-label="Search" placeholder="Voucher no., party or reference" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        <TextField label="" aria-label="From date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <TextField label="" aria-label="To date" type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
        <SelectField label="" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </SelectField>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr><th className="px-4 py-3">Voucher no.</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">{m.party}</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3 text-right">Amount ₹</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && <tr><td colSpan={5} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
            {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No {m.plural.toLowerCase()} found.</td></tr>}
            {data?.items.map((v) => (
              <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`${m.base}/${v.id}`)}>
                <td className="px-4 py-3 font-mono font-medium text-slate-900">{v.voucherNo} {v.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}</td>
                <td className="px-4 py-3 tabular-nums">{formatDate(v.voucherDate)}</td>
                <td className="px-4 py-3">{v.partyName}</td>
                <td className="px-4 py-3">{MODE_LABEL[v.mode]}{v.reference && <span className="text-slate-500"> · {v.reference}</span>}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(v.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

export function VoucherFormPage({ kind }: { kind: VoucherKind }) {
  const m = META[kind];
  const navigate = useNavigate();
  const [uid] = useState(() => crypto.randomUUID());
  const [party, setParty] = useState<Party | null>(null);
  const [voucherDate, setVoucherDate] = useState(todayIst());
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  // Allocation inputs per bill; null = follow the automatic oldest-first split.
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bills = useFetch<{ items: OutstandingBill[] }>(party ? `/accounts/parties/${party.id}/open-bills?kind=${kind}` : null);
  const open = bills.data?.items ?? [];

  const amountPaise = parseRupees(amount || "0");
  const discountPaise = parseRupees(discount || "0");
  const available = (amountPaise ?? 0) + (discountPaise ?? 0);
  const auto = Object.fromEntries(allocateOldestFirst(open, available).map((a) => [keyOf(a), rupees(a.amountPaise)]));
  const alloc = manual ?? auto;
  const allocatedPaise = open.reduce((s, b) => s + (parseRupees(alloc[keyOf(b)] || "0") ?? 0), 0);
  const totalDue = open.reduce((s, b) => s + b.outstandingPaise, 0);
  const advance = available - allocatedPaise;

  const choose = (p: Party | null) => {
    setParty(p);
    setManual(null);
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: Record<string, string[]> = {};
    if (!party) next.partyId = [`Choose a ${m.party.toLowerCase()}`];
    if (amountPaise === null || available <= 0) next.amountPaise = ["Enter an amount"];
    if (discountPaise === null) next.discountPaise = ["Enter a valid discount"];
    if (mode === "cheque" && !reference.trim()) next.reference = ["Enter the cheque number"];
    const allocations = [];
    for (const b of open) {
      const v = parseRupees(alloc[keyOf(b)] || "0");
      if (v === null) next[`bill-${keyOf(b)}`] = ["Invalid amount"];
      else if (v > b.outstandingPaise) next[`bill-${keyOf(b)}`] = [`Only ₹${formatPaise(b.outstandingPaise)} due`];
      else if (v > 0) allocations.push({ targetType: b.targetType, targetId: b.targetId, amountPaise: v });
    }
    if (advance < 0) next.allocations = ["Allocated more than the amount + discount"];
    if ((discountPaise ?? 0) > 0 && advance > 0) next.discountPaise = ["A discount can only be given against bills it settles"];
    setErrors(next);
    if (Object.keys(next).length) return setFormError("Please fix the highlighted fields.");
    setSaving(true);
    try {
      const v = await api<VoucherDetail>("/vouchers", {
        method: "POST",
        body: { uid, kind, partyId: party?.id, voucherDate, amountPaise, discountPaise, mode, reference, remarks, allocations },
      });
      navigate(`${m.base}/${v.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
        if (err.code === "OUTSTANDING_CHANGED") bills.reload();
      } else setFormError("Something went wrong. Please try again.");
    }
  }

  return (
    <div>
      <PageHeader title={`New ${m.title.toLowerCase()}`} subtitle={<Link to={m.base} className="text-slate-600 hover:underline">← All {m.plural.toLowerCase()}</Link>} />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <SearchPicker<Party>
                label={m.party}
                path="/parties"
                extraParams={{ type: m.partyType }}
                selected={party}
                onSelect={choose}
                render={(p) => ({ title: p.name, subtitle: [p.phone, p.city].filter(Boolean).join(" · ") })}
                errors={errors.partyId}
              />
            </div>
            <TextField label="Date" type="date" max={todayIst()} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} errors={errors.voucherDate} />
            <SelectField label="Mode" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
              {MODES.map((x) => <option key={x} value={x}>{MODE_LABEL[x]}</option>)}
            </SelectField>
            <TextField label={mode === "cheque" ? "Cheque no." : "Reference (UTR / txn id)"} value={reference} onChange={(e) => setReference(e.target.value)} errors={errors.reference} />
            <TextField label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <TextField label="Amount ₹" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setManual(null); }} errors={errors.amountPaise} />
            <TextField
              label={kind === "receipt" ? "Discount allowed ₹" : "Discount received ₹"}
              hint="Settlement discount, if any"
              inputMode="decimal"
              value={discount}
              onChange={(e) => { setDiscount(e.target.value); setManual(null); }}
              errors={errors.discountPaise}
            />
          </div>
        </Card>

        {party && (
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Bills to settle <span className="font-normal text-slate-500">· oldest first</span></h2>
              {manual && <Button type="button" variant="secondary" onClick={() => setManual(null)}>Reset to oldest first</Button>}
            </div>
            {bills.loading && !bills.data ? <Spinner className="h-5 w-5" /> : open.length === 0 ? (
              <p className="text-sm text-slate-500">No pending bills. The amount will be kept as an advance.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr><th className="py-2 pr-4">Bill</th><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Days</th><th className="py-2 pr-4 text-right">Due ₹</th><th className="py-2 text-right">Settle ₹</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {open.map((b) => (
                      <tr key={keyOf(b)}>
                        <td className="py-2 pr-4 font-mono">{b.docNo}</td>
                        <td className="py-2 pr-4 tabular-nums">{formatDate(b.docDate)}</td>
                        <td className="py-2 pr-4">{b.daysPending} {b.overdue && b.targetType === "sale" && <Badge tone="red">Overdue</Badge>}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{formatPaise(b.outstandingPaise)}</td>
                        <td className="py-2 text-right">
                          <TextField
                            label=""
                            aria-label={`Settle ${b.docNo}`}
                            inputMode="decimal"
                            className="ml-auto w-32"
                            value={alloc[keyOf(b)] ?? ""}
                            onChange={(e) => setManual({ ...alloc, [keyOf(b)]: e.target.value })}
                            errors={errors[`bill-${keyOf(b)}`]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="text-sm font-medium">
                    <tr><td colSpan={3} className="pt-3">Total due</td><td className="pt-3 text-right tabular-nums">{formatPaise(totalDue)}</td><td className="pt-3 text-right tabular-nums">{formatPaise(allocatedPaise)}</td></tr>
                  </tfoot>
                </table>
              </div>
            )}
            {errors.allocations && <p className="mt-2 text-sm text-red-700">{errors.allocations[0]}</p>}
            <p className="mt-3 text-sm text-slate-600">
              {advance > 0 ? <>₹{formatPaise(advance)} will be kept as an <strong>advance</strong>.</> : advance < 0 ? <span className="text-red-700">Allocated ₹{formatPaise(-advance)} more than the amount.</span> : "Fully allocated."}
            </p>
          </Card>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>Save {m.title.toLowerCase()}</Button>
        </div>
      </form>
    </div>
  );
}

export function VoucherDetailPage({ kind }: { kind: VoucherKind }) {
  const m = META[kind];
  const { id } = useParams();
  const { data: v, error, reload } = useFetch<VoucherDetail>(`/vouchers/${id}`);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!v) return <Spinner />;
  if (v.kind !== kind) return <Alert tone="error">This voucher is a {v.kind}.</Alert>;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${m.title} ${v.voucherNo}`}
        subtitle={<Link to={m.base} className="text-slate-600 hover:underline">← All {m.plural.toLowerCase()}</Link>}
        actions={<Link to={`/statement?party=${v.partyId}`}><Button variant="secondary">Statement</Button></Link>}
      />
      {v.status === "cancelled" && <Alert tone="error">Cancelled: {v.cancelReason}</Alert>}
      <Card className="grid gap-4 p-5 text-sm md:grid-cols-4">
        <div><p className="text-slate-500">{m.verb}</p><p className="font-medium">{v.partyName}</p></div>
        <div><p className="text-slate-500">Date</p><p className="font-medium">{formatDate(v.voucherDate)}</p></div>
        <div><p className="text-slate-500">Mode</p><p className="font-medium">{MODE_LABEL[v.mode]}{v.reference && ` · ${v.reference}`}</p></div>
        <div><p className="text-slate-500">Amount</p><p className="text-lg font-semibold tabular-nums">₹{formatPaise(v.amountPaise)}</p>{v.discountPaise > 0 && <p className="text-slate-500">+ ₹{formatPaise(v.discountPaise)} discount</p>}</div>
        {v.remarks && <div className="md:col-span-4"><p className="text-slate-500">Remarks</p><p>{v.remarks}</p></div>}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Settled bills</h2>
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {v.allocations.map((a) => (
              <tr key={keyOf(a)}>
                <td className="py-2 font-mono">{a.targetType === "sale" ? <Link className="hover:underline" to={`/sales/${a.targetId}`}>{a.docNo}</Link> : a.targetType === "purchase" ? <Link className="hover:underline" to={`/purchases/${a.targetId}`}>{a.docNo}</Link> : a.docNo}</td>
                <td className="py-2 text-right tabular-nums">{formatPaise(a.amountPaise)}</td>
              </tr>
            ))}
            {v.advancePaise > 0 && <tr><td className="py-2">Advance (on account)</td><td className="py-2 text-right tabular-nums">{formatPaise(v.advancePaise)}</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Accounting entry</h2>
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Account</th><th className="py-1 text-right">Debit ₹</th><th className="py-1 text-right">Credit ₹</th></tr></thead>
          <tbody>{v.journal.map((j, i) => <tr key={i}><td className="py-1">{j.account}</td><td className="py-1 text-right tabular-nums">{j.debitPaise ? formatPaise(j.debitPaise) : ""}</td><td className="py-1 text-right tabular-nums">{j.creditPaise ? formatPaise(j.creditPaise) : ""}</td></tr>)}</tbody>
        </table>
      </Card>
      {v.status === "posted" && (
        <CancelBox label={`Cancel this ${m.title.toLowerCase()}`} onCancel={async (reason) => { await api(`/vouchers/${v.id}/cancel`, { method: "POST", body: { reason } }); reload(); }} />
      )}
    </div>
  );
}
