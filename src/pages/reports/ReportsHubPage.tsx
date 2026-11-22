import { Link } from "react-router";
import { PageHeader } from "../../components/ui";

const GROUPS: { title: string; reports: { label: string; to: string; hint: string }[] }[] = [
  {
    title: "Transactions",
    reports: [
      { label: "Sales report", to: "/reports/sales", hint: "Invoices with taxable value, GST and totals" },
      { label: "Purchase report", to: "/reports/purchases", hint: "Supplier bills with GST" },
      { label: "Sales statistics", to: "/stats", hint: "Monthly sales and top products, retailers and groups" },
      { label: "Business expenses", to: "/expenses", hint: "Spend per month, split by head" },
    ],
  },
  {
    title: "Party",
    reports: [
      { label: "Credit / outstanding", to: "/outstanding", hint: "Who owes you and for how long, with WhatsApp reminders" },
      { label: "Statement of account", to: "/statement", hint: "Every bill and payment for one party" },
    ],
  },
  {
    title: "Items & stock",
    reports: [{ label: "Stock report", to: "/stock", hint: "Quantity, average cost and value per product" }],
  },
  {
    title: "GST",
    reports: [{ label: "GST slab-wise report (PDF)", to: "/reports/gst", hint: "Sales and purchases by GST rate, for the auditor" }],
  },
  {
    title: "Accounts",
    reports: [
      { label: "Profit & loss", to: "/profit-loss", hint: "Income and expenses for a period" },
      { label: "Balance sheet", to: "/balance-sheet", hint: "What the shop owns and owes" },
      { label: "Trial balance", to: "/trial-balance", hint: "All ledgers with debit and credit totals" },
      { label: "Ledger report", to: "/reports/ledger", hint: "Entries in one ledger, e.g. Cash or Rent" },
    ],
  },
];

/** All reports in one place, grouped the way the shop looks for them. */
export function ReportsHubPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((g) => (
          <section key={g.title} className="erp-panel p-4">
            <h2 className="mb-2 font-bold text-slate-900">{g.title}</h2>
            <ul className="divide-y divide-slate-100">
              {g.reports.map((r) => (
                <li key={r.to}>
                  <Link to={r.to} className="block rounded-lg px-2 py-2.5 hover:bg-[var(--erp-row-hover)]">
                    <span className="font-semibold text-[var(--erp-blue)]">{r.label}</span>
                    <span className="block text-sm text-slate-600">{r.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
