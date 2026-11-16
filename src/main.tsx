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
import { PartyFormPage } from "./pages/parties/PartyFormPage";
import { ProductFormPage } from "./pages/products/ProductFormPage";
import { ProductsPage } from "./pages/products/ProductsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OpeningStockPage } from "./pages/purchases/OpeningStockPage";
import { PurchaseDetailPage } from "./pages/purchases/PurchaseDetailPage";
import { PurchaseFormPage } from "./pages/purchases/PurchaseFormPage";
import { PurchaseReturnFormPage } from "./pages/purchases/PurchaseReturnFormPage";
import { PurchaseReturnsPage } from "./pages/purchases/PurchaseReturnsPage";
import { PurchasesPage } from "./pages/purchases/PurchasesPage";
import { InvoicePrintPage } from "./pages/sales/InvoicePrintPage";
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
      {
        element: <RequireAuth />,
        children: [
          { path: "/sales/:id/print", element: <InvoicePrintPage /> },
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomePage /> },
              { path: "/products", element: <ProductsPage /> },
              { path: "/products/new", element: <ProductFormPage key="new" /> },
              { path: "/products/:id", element: <ProductFormPage /> },
              { path: "/parties", element: <PartiesPage /> },
              { path: "/parties/new", element: <PartyFormPage key="new" /> },
              { path: "/parties/:id", element: <PartyFormPage /> },
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
              { path: "/account", element: <AccountPage /> },
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
