// A4 GST tax invoice, printed from the browser (Ctrl+P / "Print"). Opens in its
// own tab without the app chrome. Uses only the stored invoice snapshot, so a
// reprint is always identical to the original.
import { useParams } from "react-router";
import { formatDate } from "../../../shared/gst";
import { stateName } from "../../../shared/india";
import type { ShopSettings } from "../../../shared/masters";
import { formatPaise, formatRate } from "../../../shared/money";
import { amountInWords, type SaleDetail } from "../../../shared/sales";
import { Alert, Button, Spinner } from "../../components/ui";
import { useFetch } from "../../lib/useFetch";

export function InvoicePrintPage() {
  const { id } = useParams();
  const sale = useFetch<SaleDetail>(`/sales/${id}`);
  const shop = useFetch<ShopSettings>("/settings/shop");
  const error = sale.error ?? shop.error;
  if (error) return <div className="p-8"><Alert tone="error">{error}</Alert></div>;
  if (!sale.data || !shop.data) return <Spinner className="mx-auto mt-10 h-6 w-6" />;
  const s = sale.data;
  const sh = shop.data;

  // GST summary by rate (the HSN/rate-wise breakup auditors expect).
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const i of s.items) {
    const row = byRate.get(i.gstRateBp) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += i.taxablePaise;
    row.cgst += i.cgstPaise;
    row.sgst += i.sgstPaise;
    row.igst += i.igstPaise;
    byRate.set(i.gstRateBp, row);
  }
  const totalQty = s.items.reduce((a, i) => a + i.quantity, 0);

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 print:hidden">
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <article className="invoice relative mx-auto max-w-[210mm] bg-white p-[10mm] text-[11px] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none">
        {s.status === "cancelled" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-30 text-7xl font-bold tracking-widest text-red-600/20">CANCELLED</span>
          </div>
        )}
        <header className="flex items-start justify-between gap-4 border border-black p-3">
          <div className="flex items-start gap-3">
            {sh.logoDataUrl && <img src={sh.logoDataUrl} alt="" className="h-16 w-16 object-contain" />}
            <div>
              <h1 className="text-lg font-bold uppercase">{sh.shopName}</h1>
              <p>{[sh.address, sh.city, sh.pincode].filter(Boolean).join(", ")}</p>
              <p>{stateName(sh.stateCode)} (Code {sh.stateCode}){sh.phone && ` · Ph: ${sh.phone}`}{sh.email && ` · ${sh.email}`}</p>
              {sh.gstin && <p className="font-semibold">GSTIN: {sh.gstin}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-base font-bold">TAX INVOICE</p>
            <p className="text-[10px]">Original for recipient</p>
          </div>
        </header>

        <section className="grid grid-cols-2 border-x border-b border-black">
          <div className="border-r border-black p-3">
            <p className="font-semibold">Bill to</p>
            <p className="font-bold">{s.bill.name}</p>
            {s.bill.address && <p>{s.bill.address}</p>}
            {s.bill.phone && <p>Ph: {s.bill.phone}</p>}
            <p>GSTIN: {s.bill.gstin ?? "Unregistered"}</p>
            <p>Place of supply: {stateName(s.bill.stateCode)} ({s.bill.stateCode})</p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 p-3">
            <span>Invoice no.</span><span className="font-bold">{s.invoiceNo}</span>
            <span>Invoice date</span><span>{formatDate(s.invoiceDate)}</span>
            <span>Payment</span><span>{s.collectionType === "credit" ? `Credit · due ${formatDate(s.dueDate)}` : "Paid"}</span>
            {s.salesman && <><span>Sales man</span><span>{s.salesman}</span></>}
          </div>
        </section>

        <table className="w-full border-collapse border-x border-b border-black">
          <thead>
            <tr className="border-b border-black bg-slate-100 text-left">
              {["#", "Description", "HSN", "Qty", "Rate ₹", "Taxable ₹", "GST", "Tax ₹", "Amount ₹"].map((h, i) => (
                <th key={h} className={`border-r border-black px-1.5 py-1 last:border-r-0 ${i >= 3 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.items.map((i, idx) => (
              <tr key={i.id} className="align-top">
                <td className="border-r border-black px-1.5 py-1">{idx + 1}</td>
                <td className="border-r border-black px-1.5 py-1">
                  <p className="font-semibold">{i.brand} {i.productName}</p>
                  {i.serials.length > 0 && <p className="text-[10px]">S/N: {i.serials.join(", ")}</p>}
                </td>
                <td className="border-r border-black px-1.5 py-1">{i.hsnCode}</td>
                <td className="border-r border-black px-1.5 py-1 text-right">{i.quantity} {i.unit}</td>
                <td className="border-r border-black px-1.5 py-1 text-right">{formatPaise(i.ratePaise)}</td>
                <td className="border-r border-black px-1.5 py-1 text-right">{formatPaise(i.taxablePaise)}</td>
                <td className="border-r border-black px-1.5 py-1 text-right">{formatRate(i.gstRateBp)}</td>
                <td className="border-r border-black px-1.5 py-1 text-right">{formatPaise(i.cgstPaise + i.sgstPaise + i.igstPaise)}</td>
                <td className="px-1.5 py-1 text-right">{formatPaise(i.totalPaise)}</td>
              </tr>
            ))}
            <tr className="border-t border-black font-semibold">
              <td className="border-r border-black px-1.5 py-1" colSpan={3}>Total</td>
              <td className="border-r border-black px-1.5 py-1 text-right">{totalQty}</td>
              <td className="border-r border-black px-1.5 py-1" />
              <td className="border-r border-black px-1.5 py-1 text-right">{formatPaise(s.taxablePaise)}</td>
              <td className="border-r border-black px-1.5 py-1" />
              <td className="border-r border-black px-1.5 py-1 text-right">{formatPaise(s.cgstPaise + s.sgstPaise + s.igstPaise)}</td>
              <td className="px-1.5 py-1 text-right">{formatPaise(s.totalPaise - s.roundOffPaise)}</td>
            </tr>
          </tbody>
        </table>

        <section className="grid grid-cols-[3fr_2fr] border-x border-b border-black">
          <div className="border-r border-black p-3">
            <table className="w-full text-[10px]">
              <thead><tr className="text-left"><th>GST rate</th><th className="text-right">Taxable ₹</th>{s.isInterstate ? <th className="text-right">IGST ₹</th> : <><th className="text-right">CGST ₹</th><th className="text-right">SGST ₹</th></>}</tr></thead>
              <tbody>
                {[...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([bp, r]) => (
                  <tr key={bp}><td>{formatRate(bp)}</td><td className="text-right">{formatPaise(r.taxable)}</td>{s.isInterstate ? <td className="text-right">{formatPaise(r.igst)}</td> : <><td className="text-right">{formatPaise(r.cgst)}</td><td className="text-right">{formatPaise(r.sgst)}</td></>}</tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3"><span className="font-semibold">Amount in words:</span> {amountInWords(s.totalPaise)}</p>
            {(sh.bankName || sh.bankAccount) && (
              <p className="mt-2"><span className="font-semibold">Bank:</span> {sh.bankName} · A/c {sh.bankAccount} · IFSC {sh.bankIfsc}</p>
            )}
          </div>
          <div className="p-3">
            <dl className="grid grid-cols-2 gap-y-0.5">
              <dt>Taxable value</dt><dd className="text-right">{formatPaise(s.taxablePaise)}</dd>
              {s.isInterstate ? <><dt>IGST</dt><dd className="text-right">{formatPaise(s.igstPaise)}</dd></> : <><dt>CGST</dt><dd className="text-right">{formatPaise(s.cgstPaise)}</dd><dt>SGST</dt><dd className="text-right">{formatPaise(s.sgstPaise)}</dd></>}
              <dt>Round off</dt><dd className="text-right">{formatPaise(s.roundOffPaise)}</dd>
              <dt className="border-t border-black pt-1 text-sm font-bold">Net amount</dt><dd className="border-t border-black pt-1 text-right text-sm font-bold">₹{formatPaise(s.totalPaise)}</dd>
            </dl>
          </div>
        </section>

        <footer className="grid grid-cols-2 border-x border-b border-black">
          <div className="border-r border-black p-3 text-[10px]">
            <p>Certified that the particulars given above are true and correct.</p>
            {s.remarks && <p className="mt-1">Remarks: {s.remarks}</p>}
            <p className="mt-1">Goods once sold will be taken back only as per warranty terms.</p>
          </div>
          <div className="flex flex-col items-end justify-between p-3">
            <p className="font-semibold">For {sh.shopName}</p>
            <p className="mt-10">Authorised signatory</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
