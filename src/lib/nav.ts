// The app's menu, grouped the same way as the shop's previous billing software
// so nothing has to be relearned. Used by the top menu bar and the breadcrumb.

export interface NavItem {
  label: string;
  to: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// Kept deliberately small: only what the shop uses day to day. Other screens
// (vouchers, ledgers, groups, units, trial balance, P&L, balance sheet,
// statistics) still exist at their addresses but are not on the menu.
export const NAV: NavGroup[] = [
  {
    title: "Sales",
    items: [
      { label: "Sales", to: "/sales" },
      { label: "Credit Note (Sales Return)", to: "/sales-returns" },
    ],
  },
  {
    title: "Purchase",
    items: [
      { label: "Purchase", to: "/purchases" },
      { label: "Purchase Return", to: "/purchase-returns" },
    ],
  },
  {
    title: "Credit",
    items: [
      { label: "Credit / Outstanding", to: "/outstanding" },
      { label: "Receipt (money in)", to: "/receipts" },
      { label: "Payment (money out)", to: "/payments" },
      { label: "Statement of Account", to: "/statement" },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Sales Report", to: "/reports/sales" },
      { label: "Purchase Report", to: "/reports/purchases" },
      { label: "Product / Stock Report", to: "/stock" },
      { label: "GST Slab PDF", to: "/reports/gst" },
    ],
  },
  {
    title: "Master",
    items: [
      { label: "Retailers & Suppliers", to: "/parties" },
      { label: "Products", to: "/products" },
      { label: "Opening Stock", to: "/opening-stock" },
      { label: "Shop Profile", to: "/settings" },
    ],
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
