// Module 10: follow-ups. Enquiries the shop promised to follow up; reminders go
// from the shop's own WhatsApp with one tap (no paid API, nothing sent by itself).
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { FollowUp, FollowUpStatus } from "../../shared/followups";
import { formatDate, todayIst } from "../../shared/gst";
import { whatsAppLink } from "../../shared/india";
import type { ShopSettings } from "../../shared/masters";
import { Alert, Button, Card, PageHeader, Spinner, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/useFetch";

const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

function reminderText(f: FollowUp, shop: string) {
  return `Vanakkam ${f.name}, this is ${shop}.${f.note ? ` About your enquiry (${f.note}):` : ""} we're ready for you. Please visit us when convenient. Thank you.`;
}

function NewEnquiry({ onSaved }: { onSaved: () => void }) {
  const today = todayIst();
  const blank = () => ({ uid: crypto.randomUUID(), name: "", phone: "", note: "", dueDate: plusDays(today, 7) });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Partial<Record<string, string[]>>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api<FollowUp>("/follow-ups", { method: "POST", body: form });
      setForm(blank());
      setErrors({});
      setMessage({ tone: "success", text: `Saved. We'll show ${saved.name} on ${formatDate(saved.dueDate)}.` });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage({ tone: "error", text: err.message });
      } else setMessage({ tone: "error", text: "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="space-y-4">
        <h2 className="text-base font-bold text-slate-900">New enquiry</h2>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} errors={errors.name} required />
          <TextField label="Mobile (WhatsApp)" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} errors={errors.phone} />
          <TextField label="What they asked about" value={form.note} onChange={(e) => set("note", e.target.value)} errors={errors.note} hint="e.g. Stealth fan ×4, quoted ₹6,780 each" />
          <div>
            <TextField label="Coming back on" type="date" min={today} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} errors={errors.dueDate} />
            <div className="mt-2 flex gap-2 text-sm">
              {[2, 7, 30].map((d) => (
                <button key={d} type="button" onClick={() => set("dueDate", plusDays(today, d))} className="rounded-md bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-200">
                  {d === 30 ? "1 month" : d === 7 ? "1 week" : `${d} days`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>Save enquiry</Button>
        </div>
      </form>
    </Card>
  );
}

function FollowUpCard({ f, shop, tone, onChange }: { f: FollowUp; shop: string; tone: "red" | "amber" | "slate"; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(patch: { status?: FollowUpStatus; dueDate?: string }) {
    setBusy(true);
    setError(null);
    try {
      await api(`/follow-ups/${f.id}`, { method: "PUT", body: { name: f.name, phone: f.phone, note: f.note, dueDate: f.dueDate, status: f.status, updatedAt: f.updatedAt, ...patch } });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
      setBusy(false);
    }
  }
  const border = { red: "border-red-200 bg-red-50", amber: "border-amber-200 bg-white", slate: "border-[var(--erp-panel-border)] bg-white" }[tone];
  return (
    <article className={`rounded-xl border p-4 ${border}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{f.name}</h3>
        <span className={`text-sm font-medium ${tone === "red" ? "text-red-700" : "text-slate-600"}`}>{formatDate(f.dueDate)}</span>
      </div>
      {f.phone && <p className="text-sm tabular-nums text-slate-600">{f.phone}</p>}
      {f.note && <p className="mt-1 text-sm text-slate-800">{f.note}</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <a href={whatsAppLink(f.phone, reminderText(f, shop))} target="_blank" rel="noreferrer" className="rounded-lg bg-green-700 px-3 py-1.5 font-semibold text-white hover:bg-green-800">
          WhatsApp
        </a>
        <Link to="/sales/new" onClick={() => void update({ status: "won" })} className="rounded-lg bg-[var(--erp-blue)] px-3 py-1.5 font-semibold text-white hover:bg-[var(--erp-blue-dark)]">
          Bought → bill
        </Link>
        <button type="button" disabled={busy} onClick={() => update({ dueDate: plusDays(todayIst() > f.dueDate ? todayIst() : f.dueDate, 3) })} className="rounded-lg px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-inset ring-[var(--erp-field-border)] hover:bg-slate-50">
          +3 days
        </button>
        <button type="button" disabled={busy} onClick={() => update({ status: "lost" })} className="rounded-lg px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-inset ring-[var(--erp-field-border)] hover:bg-slate-50">
          Not interested
        </button>
      </div>
    </article>
  );
}

export function FollowUpsPage() {
  const today = todayIst();
  const [tab, setTab] = useState<"open" | "won" | "lost">("open");
  const { data, error, loading, reload } = useFetch<{ items: FollowUp[] }>(`/follow-ups?status=${tab}`);
  const shop = useFetch<ShopSettings>("/settings/shop");
  const shopName = shop.data?.shopName ?? "our shop";
  const items = data?.items ?? [];
  const columns: { title: string; tone: "red" | "amber" | "slate"; list: FollowUp[] }[] = [
    { title: "Overdue", tone: "red", list: items.filter((f) => f.dueDate < today) },
    { title: "Today", tone: "amber", list: items.filter((f) => f.dueDate === today) },
    { title: "Upcoming", tone: "slate", list: items.filter((f) => f.dueDate > today) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Follow-ups" subtitle="Customers who enquired and said they'll come back. Each morning, send today's reminders from your own WhatsApp." />
      <NewEnquiry onSaved={reload} />

      <div role="tablist" aria-label="Show" className="inline-flex rounded-lg border border-[var(--erp-panel-border)] bg-white p-1 text-sm">
        {(["open", "won", "lost"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 font-medium ${tab === t ? "bg-[var(--erp-blue)] text-white" : "text-slate-600 hover:text-slate-900"}`}>
            {t === "open" ? "To follow up" : t === "won" ? "Bought" : "Not interested"}
          </button>
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data && <Spinner className="mx-auto h-6 w-6" />}

      {tab === "open" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {columns.map((c) => (
            <section key={c.title} className="space-y-3">
              <h2 className={`font-semibold ${c.tone === "red" ? "text-red-700" : c.tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>
                {c.title} · {c.list.length}
              </h2>
              {c.list.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
              {c.list.map((f) => (
                <FollowUpCard key={`${f.id}-${f.updatedAt}`} f={f} shop={shopName} tone={c.tone} onChange={reload} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="erp-table-wrap">
          <table className="erp-table w-full min-w-[640px] text-sm">
            <thead className="erp-thead text-left">
              <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Mobile</th><th className="px-4 py-3">Enquiry</th><th className="px-4 py-3">Due date</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Nothing here yet.</td></tr>}
              {items.map((f) => (
                <tr key={f.id}><td className="px-4 py-3 font-medium">{f.name}</td><td className="px-4 py-3 tabular-nums">{f.phone || "—"}</td><td className="px-4 py-3">{f.note || "—"}</td><td className="px-4 py-3">{formatDate(f.dueDate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
