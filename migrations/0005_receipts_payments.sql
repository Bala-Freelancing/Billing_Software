-- Module 5: receipts from customers, payments to suppliers, bill-wise allocation.

INSERT INTO ledgers (name, group_id, system_key, created_at)
VALUES ('Bank Account', (SELECT id FROM ledger_groups WHERE system_key = 'bank'), 'bank', 0);

-- Receipts (money in from customers) and payments (money out to suppliers).
CREATE TABLE money_vouchers (
  id              INTEGER PRIMARY KEY,
  uid             TEXT    NOT NULL UNIQUE,
  kind            TEXT    NOT NULL CHECK (kind IN ('receipt', 'payment')),
  voucher_no      TEXT    NOT NULL UNIQUE,
  financial_year  TEXT    NOT NULL CHECK (length(financial_year) = 4),
  sequence_no     INTEGER NOT NULL,
  party_id        INTEGER NOT NULL REFERENCES parties (id),
  voucher_date    TEXT    NOT NULL CHECK (voucher_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
  discount_paise  INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  mode            TEXT    NOT NULL CHECK (mode IN ('cash', 'upi', 'bank', 'cheque')),
  reference       TEXT    NOT NULL DEFAULT '',
  remarks         TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  cancel_reason   TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (amount_paise + discount_paise > 0),
  UNIQUE (kind, financial_year, sequence_no)
) STRICT;

CREATE INDEX idx_money_vouchers_party ON money_vouchers (party_id, voucher_date);
CREATE INDEX idx_money_vouchers_date  ON money_vouchers (kind, voucher_date, status);

-- Which bills a receipt/payment settles. 'opening' targets the party's opening
-- balance (target_id = party id). Unallocated remainder is an advance.
CREATE TABLE voucher_allocations (
  id           INTEGER PRIMARY KEY,
  voucher_id   INTEGER NOT NULL REFERENCES money_vouchers (id),
  target_type  TEXT    NOT NULL CHECK (target_type IN ('opening', 'sale', 'purchase')),
  target_id    INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0)
) STRICT;

CREATE INDEX idx_voucher_allocations_target  ON voucher_allocations (target_type, target_id);
CREATE INDEX idx_voucher_allocations_voucher ON voucher_allocations (voucher_id);

-- Allow the new journal source types. The list now also reserves 'journal'
-- (general vouchers, Module 6) so the table does not need another rebuild.
CREATE TABLE journal_entries_new (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT    NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_type TEXT    NOT NULL CHECK (source_type IN ('purchase', 'purchase_return', 'sale', 'sales_return', 'receipt', 'payment', 'journal')),
  source_id   INTEGER NOT NULL,
  narration   TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  created_at  INTEGER NOT NULL,
  UNIQUE (source_type, source_id)
) STRICT;
INSERT INTO journal_entries_new SELECT * FROM journal_entries;
CREATE TABLE journal_lines_new (
  id           INTEGER PRIMARY KEY,
  entry_id     INTEGER NOT NULL REFERENCES journal_entries_new (id),
  ledger_id    INTEGER REFERENCES ledgers (id),
  party_id     INTEGER REFERENCES parties (id),
  debit_paise  INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  CHECK ((ledger_id IS NULL) <> (party_id IS NULL)),
  CHECK ((debit_paise = 0) <> (credit_paise = 0))
) STRICT;
INSERT INTO journal_lines_new SELECT * FROM journal_lines;
DROP TABLE journal_lines;
DROP TABLE journal_entries;
ALTER TABLE journal_entries_new RENAME TO journal_entries;
ALTER TABLE journal_lines_new RENAME TO journal_lines;
CREATE INDEX idx_journal_entries_date ON journal_entries (entry_date, status);
CREATE INDEX idx_journal_lines_entry  ON journal_lines (entry_id);
CREATE INDEX idx_journal_lines_ledger ON journal_lines (ledger_id);
CREATE INDEX idx_journal_lines_party  ON journal_lines (party_id);
