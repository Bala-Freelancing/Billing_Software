// The app's side menu. Used by the sidebar and the breadcrumb.

export interface NavItem {
  label: string;
  to: string;
}

export interface NavGroup {
  title: string;
  /** SVG path data for the group's icon (24×24, stroke). */
  icon: string;
  items: NavItem[];
}

// Kept deliberately small: only what the shop uses day to day. Other screens
// (vouchers, ledgers, groups, units, trial balance, P&L, balance sheet,
// statistics) still exist at their addresses but are not on the menu.
export const NAV: NavGroup[] = [
  {
    title: "Sales",
    icon: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
    items: [
      { label: "Sales", to: "/sales" },
      { label: "Credit note (sales return)", to: "/sales-returns" },
    ],
  },
  {
    title: "Purchase",
    icon: "M3 4h2l2.4 11h11.2L21 7H6.2M9 20h.01M18 20h.01",
    items: [
      { label: "Purchase", to: "/purchases" },
      { label: "Purchase return", to: "/purchase-returns" },
    ],
  },
  {
    title: "Payments & credit",
    icon: "M3 6h18v13H3zM3 10h18M7 15h3",
    items: [
      { label: "Credit / outstanding", to: "/outstanding" },
      { label: "Receipt (money in)", to: "/receipts" },
      { label: "Payment (money out)", to: "/payments" },
      { label: "Statement of account", to: "/statement" },
    ],
  },
  {
    title: "Expenses",
    icon: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
    items: [{ label: "Business expenses", to: "/expenses" }],
  },
  {
    title: "Masters",
    icon: "M4 6h16M4 12h16M4 18h10",
    items: [
      { label: "Retailers & suppliers", to: "/parties" },
      { label: "Products", to: "/products" },
      { label: "Opening stock", to: "/opening-stock" },
    ],
  },
  {
    title: "Reports",
    icon: "M5 20V10M12 20V4M19 20v-7",
    items: [
      { label: "Sales report", to: "/reports/sales" },
      { label: "Purchase report", to: "/reports/purchases" },
      { label: "Product / stock report", to: "/stock" },
      { label: "GST slab PDF", to: "/reports/gst" },
    ],
  },
  {
    title: "Settings",
    icon: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
    items: [{ label: "Shop profile", to: "/settings" }],
  },
];

/** Menu group for a path: the item whose path is the longest prefix of it. */
export function groupFor(pathname: string): NavGroup | null {
  let best: { group: NavGroup; len: number } | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      if ((pathname === item.to || pathname.startsWith(`${item.to}/`)) && item.to.length > (best?.len ?? 0)) best = { group, len: item.to.length };
    }
  }
  return best?.group ?? null;
}
