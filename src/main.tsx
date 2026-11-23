import { SalesStatsPage, StockReportPage } from "./pages/reports/StatsPages";
import { BalanceSheetPage, LedgerReportPage, ProfitLossPage, TrialBalancePage } from "./pages/reports/FinancialPages";
import { GstReportPage, RegisterPage } from "./pages/reports/ReportPages";
import { LedgerGroupsPage, ProductGroupsPage, UnitsPage } from "./pages/masters/CatalogPages";
import { ExpenseApprovalPage, ExpenseDetailPage, ExpenseFormPage, ExpensesPage } from "./pages/accounts/ExpensePages";
import { LedgersPage } from "./pages/accounts/LedgersPage";
import { OutstandingPage, StatementPage } from "./pages/accounts/StatementPages";
import { VoucherDetailPage, VoucherFormPage, VouchersPage } from "./pages/accounts/VoucherPages";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";
import { AppLayout } from "./layouts/AppLayout";
import { AccountPage } from "./pages/AccountPage";
import { NotFoundPage, RouteErrorPage } from "./pages/ErrorPages";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PartiesPage } from "./pages/parties/PartiesPage";
import { ReportsHubPage } from "./pages/reports/ReportsHubPage";
import { FollowUpsPage } from "./pages/FollowUpsPage";
import { ImportPage } from "./pages/ImportPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { ProductsPage } from "./pages/products/ProductsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OpeningStockPage } from "./pages/purchases/OpeningStockPage";
import { PurchaseDetailPage } from "./pages/purchases/PurchaseDetailPage";
import { PurchaseFormPage } from "./pages/purchases/PurchaseFormPage";
import { PurchaseReturnFormPage } from "./pages/purchases/PurchaseReturnFormPage";
import { PurchaseReturnsPage } from "./pages/purchases/PurchaseReturnsPage";
import { PurchasesPage } from "./pages/purchases/PurchasesPage";
import { InvoicePrintPage, PublicInvoicePage } from "./pages/sales/InvoicePrintPage";
import { SaleDetailPage } from "./pages/sales/SaleDetailPage";
import { SaleFormPage } from "./pages/sales/SaleFormPage";
import { SalesPage } from "./pages/sales/SalesPage";
import { SalesReturnFormPage, SalesReturnsPage } from "./pages/sales/SalesReturnPages";
import { GuestOnly, RequireAuth } from "./routes/guards";

const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      { element: <GuestOnly />, children: [{ path: "/login", element: <LoginPage /> }] },
      // Public: an invoice sent on WhatsApp. No login; the link's token is the key.
      { path: "/i/:token", element: <PublicInvoicePage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/sales/:id/print", element: <InvoicePrintPage /> },
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomePage /> },
              { path: "/products", element: <ProductsPage /> },
              { path: "/products/new", element: <ProductsPage /> },
              { path: "/products/:id", element: <ProductsPage /> },
              { path: "/parties", element: <PartiesPage /> },
              { path: "/parties/new", element: <PartiesPage /> },
              { path: "/parties/:id", element: <PartiesPage /> },
              { path: "/settings", element: <SettingsPage /> },
              { path: "/purchases", element: <PurchasesPage /> },
              { path: "/purchases/new", element: <PurchaseFormPage /> },
              { path: "/purchases/:id", element: <PurchaseDetailPage /> },
              { path: "/purchase-returns", element: <PurchaseReturnsPage /> },
              { path: "/purchase-returns/new", element: <PurchaseReturnFormPage /> },
              { path: "/opening-stock", element: <OpeningStockPage /> },
              { path: "/sales", element: <SalesPage /> },
              { path: "/sales/new", element: <SaleFormPage /> },
              { path: "/sales/:id", element: <SaleDetailPage /> },
              { path: "/sales-returns", element: <SalesReturnsPage /> },
              { path: "/sales-returns/new", element: <SalesReturnFormPage /> },
              { path: "/receipts", element: <VouchersPage key="receipt" kind="receipt" /> },
              { path: "/receipts/new", element: <VoucherFormPage key="receipt" kind="receipt" /> },
              { path: "/receipts/:id", element: <VoucherDetailPage key="receipt" kind="receipt" /> },
              { path: "/payments", element: <VouchersPage key="payment" kind="payment" /> },
              { path: "/payments/new", element: <VoucherFormPage key="payment" kind="payment" /> },
              { path: "/payments/:id", element: <VoucherDetailPage key="payment" kind="payment" /> },
              { path: "/statement", element: <StatementPage /> },
              { path: "/outstanding", element: <OutstandingPage /> },
              { path: "/reports", element: <ReportsHubPage /> },
              { path: "/reports/sales", element: <RegisterPage key="sales" kind="sales" /> },
              { path: "/reports/purchases", element: <RegisterPage key="purchase" kind="purchase" /> },
              { path: "/reports/gst", element: <GstReportPage /> },
              { path: "/reports/ledger", element: <LedgerReportPage /> },
              { path: "/stats", element: <SalesStatsPage /> },
              { path: "/stock", element: <StockReportPage /> },
              { path: "/trial-balance", element: <TrialBalancePage /> },
              { path: "/profit-loss", element: <ProfitLossPage /> },
              { path: "/balance-sheet", element: <BalanceSheetPage /> },
              { path: "/ledgers", element: <LedgersPage /> },
              { path: "/ledger-groups", element: <LedgerGroupsPage /> },
              { path: "/product-groups", element: <ProductGroupsPage /> },
              { path: "/units", element: <UnitsPage /> },
              { path: "/expenses", element: <ExpensesPage /> },
              { path: "/expenses/new", element: <ExpenseFormPage key="new" /> },
              { path: "/expenses/approval", element: <ExpenseApprovalPage /> },
              { path: "/expenses/:id", element: <ExpenseDetailPage /> },
              { path: "/expenses/:id/edit", element: <ExpenseFormPage key="edit" /> },
              { path: "/account", element: <AccountPage /> },
              { path: "/follow-ups", element: <FollowUpsPage /> },
              { path: "/reviews", element: <ReviewsPage /> },
              { path: "/import", element: <ImportPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
