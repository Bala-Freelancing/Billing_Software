-- Module 8: indexes for report date filters.
CREATE INDEX idx_purchase_returns_date ON purchase_returns (return_date, status);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id, gst_rate_bp);
CREATE INDEX idx_purchase_items_purchase ON purchase_items (purchase_id, gst_rate_bp);
CREATE INDEX idx_sales_return_items_return ON sales_return_items (sales_return_id);
CREATE INDEX idx_purchase_return_items_return ON purchase_return_items (purchase_return_id);
