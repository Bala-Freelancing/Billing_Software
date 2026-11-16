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
import { GuestOnly, RequireAuth } from "./routes/guards";

const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      { element: <GuestOnly />, children: [{ path: "/login", element: <LoginPage /> }] },
      {
        element: <RequireAuth />,
        children: [
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
