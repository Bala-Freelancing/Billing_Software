import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ProductGroup } from "../../../shared/catalog";
import type { ListResponse, Product, ScanResult } from "../../../shared/masters";
import { formatPaise, formatRate, marginOnCost } from "../../../shared/money";
import { ScanInput } from "../../components/ScanInput";
import { Alert, Badge, HeaderLink, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";
import { ProductFormPanel } from "./ProductFormPanel";

/** Products: the add / edit form on top, the full list below (/products, /products/new, /products/:id). */
export function ProductsPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const params = new URLSearchParams({ q, status, group, page: String(page) });
  const { data, error, loading, reload } = useFetch<ListResponse<Product>>(`/products?${params}`);
  const groups = useFetch<{ items: ProductGroup[] }>("/product-groups");

  async function handleScan(code: string) {
    setScanMessage(null);
    try {
      const result = await api<ScanResult>(`/scan/${encodeURIComponent(code)}`);
      navigate(result.kind === "none" ? `/products/new?barcode=${encodeURIComponent(code)}` : `/products/${result.product.id}`);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setScanMessage(err instanceof ApiError ? err.message : "Scan failed.");
    }
  }

  const filter = (setter: (v: string) => void) => (e: { target: { value: string } }) => {
    setter(e.target.value);
    setPage(1);
  };
  const first = data ? (data.page - 1) * data.pageSize : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        actions={
          <>
            <HeaderLink to="/product-groups">Product groups</HeaderLink>
            <HeaderLink to="/stock">Stock report</HeaderLink>
          </>
        }
      />

      <ProductFormPanel key={id ?? "new"} onSaved={reload} />

      <section className="erp-panel">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <h2 className="mr-auto text-base font-bold text-slate-900">
            Product list {data && <span className="text-sm font-medium text-slate-500">· {data.total} products</span>}
          </h2>
          <div className="w-72 max-w-full">
            <ScanInput onScan={handleScan} />
          </div>
          <SelectField label="" aria-label="Product group" value={group} onChange={filter(setGroup)}>
            <option value="">All groups</option>
            {groups.data?.items.map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="" aria-label="Status" value={status} onChange={filter(setStatus)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </SelectField>
          <TextField label="" aria-label="Search products" placeholder="Search name, brand, HSN" value={q} onChange={filter(setQ)} />
        </div>

        {scanMessage && <Alert tone="error">{scanMessage}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {/* relative: keeps the sr-only header text inside the scroll box on phones */}
        <div className="relative overflow-x-auto">
          <table className="erp-table min-w-[1000px] w-full text-sm">
            <thead className="erp-thead text-left">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">Group</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Unit</th>
                <th className="px-3 py-3 text-right">Selling ₹</th>
                <th className="px-3 py-3 text-right" title="Weighted average purchase cost, excl. GST">Avg cost ₹</th>
                <th className="px-3 py-3 text-right">MRP ₹</th>
                <th className="px-3 py-3 text-right">Margin %</th>
                <th className="px-3 py-3 text-right">GST</th>
                <th className="px-3 py-3">HSN</th>
                <th className="px-3 py-3 text-right">Stock</th>
                <th className="px-3 py-3">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    No products found.
                  </td>
                </tr>
              )}
              {data?.items.map((p, i) => (
                <tr key={p.id} className={String(p.id) === id ? "!bg-[var(--erp-row-hover)]" : ""}>
                  <td className="px-3 py-2.5 text-slate-500">{first + i + 1}</td>
                  <td className="px-3 py-2.5">{p.category || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-slate-900">{p.name}</span>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                      <span>{p.brand}</span>
                      {p.tracksSerial && <Badge tone="blue">Serial</Badge>}
                      {!p.isActive && <Badge>Inactive</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{p.unit}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(p.sellingPricePaise)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.averageCostPaise > 0 ? formatPaise(p.averageCostPaise) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(p.mrpPaise)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{marginOnCost(p.sellingPricePaise, p.gstRateBp, p.averageCostPaise)?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right">{formatRate(p.gstRateBp)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{p.hsnCode}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.inStock <= 0 ? "text-red-700" : p.inStock <= 2 ? "text-amber-700" : ""}`}>{p.inStock}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/products/${p.id}`}
                      onClick={() => window.scrollTo({ top: 0 })}
                      aria-label={`Edit ${p.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--erp-field-border)] text-[var(--erp-blue)] hover:bg-[var(--erp-row-hover)]"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
                      </svg>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="px-4 pb-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
