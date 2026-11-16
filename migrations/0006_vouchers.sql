-- Module 6: owner-created ledgers and expense vouchers with draft → approve.

-- Optimistic locking for editable (non-system) ledgers.
ALTER TABLE ledgers ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- A few everyday expense heads so the first voucher needs no setup.
INSERT INTO ledgers (name, group_id, created_at) VALUES
  ('Rent',                  (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0),
  ('Salary & Wages',        (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0),
  ('Electricity',           (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0),
  ('Telephone & Internet',  (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0),
  ('Transport & Freight',   (SELECT id FROM ledger_groups WHERE system_key = 'direct_expenses'),   0),
  ('Office Expenses',       (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0);

-- General vouchers. Module 6 ships the 'expense' type; the type column leaves
-- room for income/contra/journal later without a rebuild of the journal table
-- (its source_type 'journal' points here).
-- Lifecycle: draft → approved (posts the journal, takes a number) | rejected.
-- Approved vouchers can be cancelled with a reason. Nothing is deleted.
CREATE TABLE general_vouchers (
  id             INTEGER PRIMARY KEY,
  uid            TEXT    NOT NULL UNIQUE,
  voucher_type   TEXT    NOT NULL DEFAULT 'expense' CHECK (voucher_type IN ('expense')),
  voucher_no     TEXT    UNIQUE,              -- set on approval (gapless; drafts never consume numbers)
  financial_year TEXT    CHECK (financial_year IS NULL OR length(financial_year) = 4),
  sequence_no    INTEGER,
  voucher_date   TEXT    NOT NULL CHECK (voucher_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  mode           TEXT    NOT NULL CHECK (mode IN ('cash', 'upi', 'bank', 'cheque')),
  reference      TEXT    NOT NULL DEFAULT '',
  remarks        TEXT    NOT NULL DEFAULT '',
  total_paise    INTEGER NOT NULL CHECK (total_paise > 0),
  status         TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'cancelled')),
  status_reason  TEXT,                        -- why it was rejected or cancelled
  approved_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK ((status IN ('approved', 'cancelled')) = (voucher_no IS NOT NULL)),
  UNIQUE (voucher_type, financial_year, sequence_no)
) STRICT;

CREATE INDEX idx_general_vouchers_status ON general_vouchers (status, voucher_date);
CREATE INDEX idx_general_vouchers_date   ON general_vouchers (voucher_date);

CREATE TABLE general_voucher_lines (
  id           INTEGER PRIMARY KEY,
  voucher_id   INTEGER NOT NULL REFERENCES general_vouchers (id),
  line_no      INTEGER NOT NULL,
  ledger_id    INTEGER NOT NULL REFERENCES ledgers (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  narration    TEXT    NOT NULL DEFAULT '',
  UNIQUE (voucher_id, line_no)
) STRICT;

CREATE INDEX idx_general_voucher_lines_ledger ON general_voucher_lines (ledger_id);
