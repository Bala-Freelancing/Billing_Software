import { useState, type FormEvent } from "react";
import type { Ledger, LedgerGroup } from "../../../shared/ledgers";
import type { ListResponse } from "../../../shared/masters";
import { Alert, Badge, Button, Card, CheckboxField, PageHeader, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

const NATURE_LABEL = { asset: "Assets", liability: "Liabilities", income: "Income", expense: "Expenses" } as const;

function LedgerForm({ groups, editing, onDone }: { groups: LedgerGroup[]; editing: Ledger | null; onDone: () => void }) {
  const firstExpense = groups.find((g) => g.systemKey === "indirect_expenses")?.id ?? groups[0]?.id ?? 0;
  const [name, setName] = useState(editing?.name ?? "");
  const [groupId, setGroupId] = useState(editing?.groupId ?? firstExpense);
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { name, groupId, isActive };
      if (editing) await api(`/ledgers/${editing.id}`, { method: "PUT", body: { ...body, updatedAt: editing.updatedAt } });
      else await api("/ledgers", { method: "POST", body });
      onDone();
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(err.message);
      } else setError("Could not save.");
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="space-y-4">
        <h2 className="text-sm font-semibold">{editing ? `Edit ${editing.name}` : "New ledger"}</h2>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="Name" value={name} onChange={(e) => { setName(e.target.value); setErrors({}); }} errors={errors.name} />
          <SelectField label="Group" value={groupId} disabled={editing?.inUse} hint={editing?.inUse ? "Fixed: already used in entries" : undefined} onChange={(e) => setGroupId(Number(e.target.value))} errors={errors.groupId}>
            {groups.filter((g) => g.allowsLedgers).map((g) => <option key={g.id} value={g.id}>{g.name} ({NATURE_LABEL[g.nature]})</option>)}
          </SelectField>
          <div className="pt-6"><CheckboxField label="Active" checked={isActive} onChange={setIsActive} /></div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
        </div>
      </form>
    </Card>
  );
}

export function LedgersPage() {
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ editing: Ledger | null } | null>(null);
  const groups = useFetch<{ items: LedgerGroup[] }>("/ledger-groups");
  const { data, error, loading, reload } = useFetch<ListResponse<Ledger>>(`/ledgers?${new URLSearchParams({ q })}`);
  return (
    <div className="space-y-6">
      <PageHeader title="Ledgers" subtitle="Account heads such as Rent, Salary and Electricity. Customers and suppliers are under Parties." actions={!form && <Button onClick={() => setForm({ editing: null })}>New ledger</Button>} />
      {form && groups.data && (
        <LedgerForm key={form.editing?.id ?? "new"} groups={groups.data.items} editing={form.editing} onDone={() => { setForm(null); reload(); }} />
      )}
      <TextField label="" aria-label="Search" placeholder="Search ledgers" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr><th className="px-4 py-3">Ledger</th><th className="px-4 py-3">Group</th><th className="px-4 py-3">Type</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && <tr><td colSpan={4} className="px-4 py-8"><Spinner className="mx-auto h-5 w-5" /></td></tr>}
            {data?.items.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{l.name} {!l.isActive && <Badge tone="red">Inactive</Badge>}</td>
                <td className="px-4 py-3">{l.groupName}</td>
                <td className="px-4 py-3">{NATURE_LABEL[l.nature]}</td>
                <td className="px-4 py-3 text-right">
                  {l.isSystem ? <Badge>Built-in</Badge> : <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={() => setForm({ editing: l })}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
