import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { ListResponse, Product, ScanResult } from "../../../shared/masters";
import { formatPaise, formatRate } from "../../../shared/money";
import { ScanInput } from "../../components/ScanInput";
import { Alert, Badge, Button, PageHeader, Pagination, SelectField, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useFetch } from "../../lib/useFetch";

export function ProductsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const params = new URLSearchParams({ q, status, page: String(page) });
  const { data, error, loading } = useFetch<ListResponse<Product>>(`/products?${params}`);

  async function handleScan(code: string) {
    setScanMessage(null);
    try {
      const result = await api<ScanResult>(`/scan/${encodeURIComponent(code)}`);
      if (result.kind === "none") {
        navigate(`/products/new?barcode=${encodeURIComponent(code)}`);
      } else {
        navigate(`/products/${result.product.id}`);
      }
    } catch (err) {
      setScanMessage(err instanceof ApiError ? err.message : "Scan failed.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Prices include GST. Scan a barcode to open its product, or to add it if it's new."
        actions={
          <Link to="/products/new">
            <Button>Add product</Button>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_2fr_1fr]">
        <ScanInput onScan={handleScan} />
        <TextField
          label=""
          aria-label="Search products"
          placeholder="Search name, brand, category, HSN"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <SelectField
          label=""
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </SelectField>
      </div>

      {scanMessage && <Alert tone="error">{scanMessage}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="erp-table-wrap">
        <table className="erp-table min-w-full text-sm">
          <thead className="erp-thead text-left">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">HSN</th>
              <th className="px-4 py-3">GST</th>
              <th className="px-4 py-3 text-right">MRP ₹</th>
              <th className="px-4 py-3 text-right">Selling ₹</th>
              <th className="px-4 py-3 text-right">In stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No products found.
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/products/${p.id}`)}>
                <td className="px-4 py-3">
                  <Link to={`/products/${p.id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {p.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                    <span>{p.brand}</span>
                    {p.category && <span>· {p.category}</span>}
                    {p.tracksSerial && <Badge tone="blue">Serial</Badge>}
                    {!p.isActive && <Badge>Inactive</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-slate-700">{p.hsnCode}</td>
                <td className="px-4 py-3">{formatRate(p.gstRateBp)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(p.mrpPaise)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPaise(p.sellingPricePaise)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.inStock} {p.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
