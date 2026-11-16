-- Optional GST on expense vouchers (input tax credit), for the rare bill that
-- charges GST (e.g. a GST-registered landlord). Off by default.
-- Additive only: existing rows get "no GST" defaults, older code keeps working.

ALTER TABLE general_vouchers ADD COLUMN gst_bill            INTEGER NOT NULL DEFAULT 0 CHECK (gst_bill IN (0, 1));
ALTER TABLE general_vouchers ADD COLUMN supplier_name       TEXT    NOT NULL DEFAULT '';
ALTER TABLE general_vouchers ADD COLUMN supplier_gstin      TEXT;
ALTER TABLE general_vouchers ADD COLUMN supplier_invoice_no TEXT    NOT NULL DEFAULT '';
ALTER TABLE general_vouchers ADD COLUMN supplier_invoice_date TEXT;
ALTER TABLE general_vouchers ADD COLUMN interstate          INTEGER NOT NULL DEFAULT 0 CHECK (interstate IN (0, 1));
ALTER TABLE general_vouchers ADD COLUMN taxable_paise       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE general_vouchers ADD COLUMN cgst_paise          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE general_vouchers ADD COLUMN sgst_paise          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE general_vouchers ADD COLUMN igst_paise          INTEGER NOT NULL DEFAULT 0;

-- Before this migration total = sum of line amounts (no tax).
UPDATE general_vouchers SET taxable_paise = total_paise;

-- amount_paise stays the taxable value of the line; tax is stored per line.
ALTER TABLE general_voucher_lines ADD COLUMN gst_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate_bp >= 0);
ALTER TABLE general_voucher_lines ADD COLUMN cgst_paise  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE general_voucher_lines ADD COLUMN sgst_paise  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE general_voucher_lines ADD COLUMN igst_paise  INTEGER NOT NULL DEFAULT 0;

-- GST-on-expenses report filter (auditor PDF, GSTR-3B ITC).
CREATE INDEX idx_general_vouchers_gst ON general_vouchers (gst_bill, voucher_date);
