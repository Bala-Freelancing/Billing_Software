// Module 11: import from Vyapar. Skeleton: the steps and what to export. The
// upload and matching are built once a real Vyapar backup or export arrives,
// so the parser follows the actual file instead of a guess.
import { Card, PageHeader } from "../components/ui";

const EXPORTS = [
  "Party list (retailers and suppliers, with opening balances)",
  "Item list with stock (HSN, GST rate, prices, quantity)",
  "Sale invoices — all 4 years",
  "Purchase bills — all 4 years",
  "Payment-In and Payment-Out",
  "Credit notes (sale returns) and Debit notes (purchase returns)",
];

const STEPS: { title: string; text: string }[] = [
  { title: "Upload", text: "A Vyapar backup file (Settings → Backup → Backup to computer), or the Excel exports listed below." },
  { title: "Read and match", text: "Parties, items and GST rates are matched to this app. Possible duplicates and missing HSN codes are listed for you to check." },
  { title: "Check the preview", text: "See how many of each record will come in. Nothing is saved yet." },
  { title: "Import", text: "Records are saved in small batches, so billing keeps working while the import runs." },
  { title: "Verify balances", text: "Total receivable, total payable and stock per item must match Vyapar exactly; if anything differs, the import stops and shows where." },
];

export function ImportPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Import from Vyapar" subtitle="Bring 4 years of parties, items, bills and payments across. Nothing is saved until you check the preview." />
      <Card>
        <h2 className="text-base font-bold text-slate-900">How it works</h2>
        <ol className="mt-3 space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row-hover)] font-semibold text-[var(--erp-blue)]">{i + 1}</span>
              <span>
                <span className="font-semibold text-slate-900">{s.title}</span>
                <span className="block text-slate-600">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-base font-bold text-slate-900">What to export from Vyapar</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-800">
            {EXPORTS.map((e) => <li key={e}>{e}</li>)}
          </ul>
          <p className="mt-3 text-sm text-slate-600">Also take a screenshot of Vyapar's totals on the same day: receivable, payable and the stock summary. The import is checked against them.</p>
        </Card>
        <Card>
          <h2 className="text-base font-bold text-slate-900">Upload</h2>
          <p className="mt-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            Upload opens once we have a sample Vyapar backup or export to build the reader against. Please share one with the developer.
          </p>
        </Card>
      </div>
    </div>
  );
}
