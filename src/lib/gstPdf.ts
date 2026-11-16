// Builds the auditor's GST report as a real PDF in the browser (no server CPU).
// jsPDF is loaded only when the owner clicks "Download PDF".
import { formatDate } from "../../shared/gst";
import { stateName } from "../../shared/india";
import type { ShopSettings } from "../../shared/masters";
import { formatPaise, formatRate } from "../../shared/money";
import type { GstReport } from "../../shared/reports";

// jsPDF's built-in fonts have no ₹ glyph, so amounts are printed without it.
const amt = (p: number) => formatPaise(p);

export async function downloadGstPdf(report: GstReport, shop: ShopSettings) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = report.kind === "sales" ? "GST Sales Report (Outward supplies)" : "GST Purchase Report (Input tax credit)";
  const slabText = report.rates.length ? report.rates.map(formatRate).join(", ") : "All slabs";
  const width = doc.internal.pageSize.getWidth();

  doc.setFontSize(14).setFont("helvetica", "bold").text(shop.shopName, 14, 14);
  doc.setFontSize(9).setFont("helvetica", "normal");
  doc.text([`GSTIN: ${shop.gstin ?? "-"}`, [shop.address, shop.city, stateName(shop.stateCode), shop.pincode].filter(Boolean).join(", ")], 14, 19);
  doc.setFontSize(12).setFont("helvetica", "bold").text(title, width - 14, 14, { align: "right" });
  doc.setFontSize(9).setFont("helvetica", "normal").text([`Period: ${formatDate(report.from)} to ${formatDate(report.to)}`, `GST slab: ${slabText}`, "Amounts in Rs."], width - 14, 19, { align: "right" });

  const head = { fillColor: [30, 41, 59] as [number, number, number], fontSize: 8 };
  const right = { halign: "right" as const };

  autoTable(doc, {
    startY: 32,
    head: [["GST rate", "Taxable value", "CGST", "SGST", "IGST", "Total tax", "Value incl. GST", "Returns (taxable)"]],
    body: [
      ...report.slabs.map((s) => [formatRate(s.rateBp), amt(s.taxablePaise), amt(s.cgstPaise), amt(s.sgstPaise), amt(s.igstPaise), amt(s.cgstPaise + s.sgstPaise + s.igstPaise), amt(s.totalPaise), amt(s.returnTaxablePaise)]),
      ["Total", amt(report.net.taxablePaise), amt(report.net.cgstPaise), amt(report.net.sgstPaise), amt(report.net.igstPaise), amt(report.net.cgstPaise + report.net.sgstPaise + report.net.igstPaise), amt(report.net.totalPaise), ""],
    ],
    headStyles: head,
    styles: { fontSize: 8 },
    columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: right, 6: right, 7: right },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === report.slabs.length) d.cell.styles.fontStyle = "bold";
    },
  });

  if (report.b2b && report.b2c) {
    autoTable(doc, {
      head: [["Supply type", "Taxable value", "CGST", "SGST", "IGST"]],
      body: [
        ["B2B (registered buyers)", amt(report.b2b.taxablePaise), amt(report.b2b.cgstPaise), amt(report.b2b.sgstPaise), amt(report.b2b.igstPaise)],
        ["B2C (consumers)", amt(report.b2c.taxablePaise), amt(report.b2c.cgstPaise), amt(report.b2c.sgstPaise), amt(report.b2c.igstPaise)],
      ],
      headStyles: head,
      styles: { fontSize: 8 },
      columnStyles: { 1: right, 2: right, 3: right, 4: right },
      tableWidth: 160,
    });
  }

  autoTable(doc, {
    head: [["Date", "Type", "Doc no.", "Party", "GSTIN", "Rate", "Taxable", "CGST", "SGST", "IGST", "Total"]],
    body: report.rows.map((r) => [
      formatDate(r.date),
      r.docType === "invoice" ? (report.kind === "sales" ? "Invoice" : "Bill") : r.docType === "return" ? (report.kind === "sales" ? "Credit note" : "Debit note") : "Expense",
      r.docNo,
      r.partyName,
      r.gstin ?? "",
      formatRate(r.rateBp),
      amt(r.taxablePaise),
      amt(r.cgstPaise),
      amt(r.sgstPaise),
      amt(r.igstPaise),
      amt(r.totalPaise),
    ]),
    foot: [["", "", "", "", "", "Total", amt(report.net.taxablePaise), amt(report.net.cgstPaise), amt(report.net.sgstPaise), amt(report.net.igstPaise), amt(report.net.totalPaise)]],
    headStyles: head,
    footStyles: { fillColor: [241, 245, 249], textColor: 15, fontStyle: "bold", fontSize: 8 },
    styles: { fontSize: 7.5 },
    columnStyles: { 6: right, 7: right, 8: right, 9: right, 10: right },
    showFoot: "lastPage",
  });

  if (report.hsn.length) {
    autoTable(doc, {
      head: [["HSN", "Rate", "Qty", "Taxable", "CGST", "SGST", "IGST"]],
      body: report.hsn.map((h) => [h.hsnCode, formatRate(h.rateBp), String(h.quantity), amt(h.taxablePaise), amt(h.cgstPaise), amt(h.sgstPaise), amt(h.igstPaise)]),
      headStyles: head,
      styles: { fontSize: 8 },
      columnStyles: { 2: right, 3: right, 4: right, 5: right, 6: right },
      tableWidth: 180,
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFontSize(7).setTextColor(120);
    doc.text(`${report.truncated ? "Listing cut at 5000 rows; totals are complete. " : ""}Page ${i} of ${pages}`, width - 14, doc.internal.pageSize.getHeight() - 6, { align: "right" });
  }
  const slabPart = report.rates.length ? `-${report.rates.map((r) => r / 100).join("_")}pct` : "";
  doc.save(`GST-${report.kind}-${report.from}-to-${report.to}${slabPart}.pdf`);
}
