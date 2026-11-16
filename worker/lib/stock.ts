// Stock quantity and weighted-average cost as of a date (?1), shared by the
// financial statements, stock report and dashboard so all value stock the same way.
//
// - qty(product_id, q): non-void stock movements dated by their source document
//   (opening stock counts from the beginning).
// - cost(product_id, v, n): opening stock and posted purchase bills up to ?1,
//   excluding GST (claimed as input credit). Average cost = v / n.
export const STOCK_CTE = `
  WITH moves AS (
    SELECT m.product_id, m.qty_delta,
           CASE m.source_type
             WHEN 'purchase' THEN (SELECT invoice_date FROM purchases WHERE id = m.source_id)
             WHEN 'purchase_return' THEN (SELECT return_date FROM purchase_returns WHERE id = m.source_id)
             WHEN 'sale' THEN (SELECT invoice_date FROM sales WHERE id = m.source_id)
             WHEN 'sales_return' THEN (SELECT return_date FROM sales_returns WHERE id = m.source_id)
             ELSE '0000-01-01' END AS d
      FROM stock_movements m WHERE m.is_void = 0),
  qty AS (SELECT product_id, SUM(qty_delta) AS q FROM moves WHERE d <= ?1 GROUP BY product_id),
  cost AS (
    SELECT product_id, SUM(v) AS v, SUM(n) AS n FROM (
      SELECT product_id, quantity * rate_paise AS v, quantity AS n FROM opening_stock WHERE status = 'posted'
      UNION ALL
      SELECT i.product_id, i.taxable_paise, i.quantity FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
       WHERE p.status = 'posted' AND p.invoice_date <= ?1
    ) GROUP BY product_id)`;
