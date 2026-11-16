-- Module 4: sales invoices, sales returns (credit notes), invoice numbering,
-- counter (walk-in) customer, shop logo and invoice prefix.

ALTER TABLE shop_settings ADD COLUMN invoice_prefix TEXT NOT NULL DEFAULT 'SV';
-- Small logo stored inline as a data: URL (≤ 150 KB), printed on invoices.
ALTER TABLE shop_settings ADD COLUMN logo_data_url TEXT;

-- The walk-in "Counter Sales" customer. Bills to it are always paid immediately.
ALTER TABLE parties ADD COLUMN is_counter INTEGER NOT NULL DEFAULT 0 CHECK (is_counter IN (0, 1));
INSERT INTO parties (name, party_type, state_code, is_counter, created_at, updated_at)
VALUES ('Counter Sales', 'customer', '33', 1, 0, 0);
CREATE UNIQUE INDEX uq_parties_one_counter ON parties (is_counter) WHERE is_counter = 1;

-- Gapless numbering per series and financial year: the counter is incremented
-- inside the same transaction that inserts the document, so a failed save rolls
-- the number back and two simultaneous saves can never share a number.
CREATE TABLE document_counters (
  series  TEXT    PRIMARY KEY,  -- e.g. 'INV-2627', 'CN-2627'
  last_no INTEGER NOT NULL CHECK (last_no >= 0)
) STRICT;

-- A statement inserting 0 here aborts the whole batch (transaction). Used to
-- assert conditions mid-batch, e.g. "every scanned unit was still in stock".
CREATE TABLE batch_guards (
  ok INTEGER NOT NULL CHECK (ok = 1)
) STRICT;

CREATE TABLE sales (
  id               INTEGER PRIMARY KEY,
  uid              TEXT    NOT NULL UNIQUE,
  invoice_no       TEXT    NOT NULL UNIQUE,
  financial_year   TEXT    NOT NULL CHECK (length(financial_year) = 4),
  sequence_no      INTEGER NOT NULL,
  customer_id      INTEGER NOT NULL REFERENCES parties (id),
  -- Buyer details as printed (snapshot; counter bills can carry a name/phone).
  bill_name        TEXT    NOT NULL,
  bill_phone       TEXT    NOT NULL DEFAULT '',
  bill_gstin       TEXT,
  bill_address     TEXT    NOT NULL DEFAULT '',
  bill_state_code  TEXT    NOT NULL,
  invoice_date     TEXT    NOT NULL CHECK (invoice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  collection_type  TEXT    NOT NULL CHECK (collection_type IN ('immediate', 'credit')),
  due_date         TEXT    NOT NULL,
  salesman         TEXT    NOT NULL DEFAULT '',
  is_interstate    INTEGER NOT NULL CHECK (is_interstate IN (0, 1)),
  taxable_paise    INTEGER NOT NULL,
  cgst_paise       INTEGER NOT NULL,
  sgst_paise       INTEGER NOT NULL,
  igst_paise       INTEGER NOT NULL,
  round_off_paise  INTEGER NOT NULL,
  total_paise      INTEGER NOT NULL CHECK (total_paise >= 0),
  remarks          TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  cancel_reason    TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (financial_year, sequence_no)
) STRICT;

CREATE INDEX idx_sales_date     ON sales (invoice_date, status);
CREATE INDEX idx_sales_customer ON sales (customer_id, invoice_date);

CREATE TABLE sale_items (
  id            INTEGER PRIMARY KEY,
  sale_id       INTEGER NOT NULL REFERENCES sales (id),
  line_no       INTEGER NOT NULL,
  product_id    INTEGER NOT NULL REFERENCES products (id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  rate_paise    INTEGER NOT NULL CHECK (rate_paise >= 0), -- per unit, GST inclusive
  mrp_paise     INTEGER NOT NULL,
  gst_rate_bp   INTEGER NOT NULL CHECK (gst_rate_bp BETWEEN 0 AND 10000),
  hsn_code      TEXT    NOT NULL,
  taxable_paise INTEGER NOT NULL,
  cgst_paise    INTEGER NOT NULL,
  sgst_paise    INTEGER NOT NULL,
  igst_paise    INTEGER NOT NULL,
  total_paise   INTEGER NOT NULL,
  -- Serials sold on this line, kept forever for the printed invoice even after a
  -- unit is returned and resold.
  serials       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(serials)),
  UNIQUE (sale_id, line_no)
) STRICT;

CREATE INDEX idx_sale_items_product ON sale_items (product_id);

CREATE TABLE sales_returns (
  id              INTEGER PRIMARY KEY,
  uid             TEXT    NOT NULL UNIQUE,
  credit_note_no  TEXT    NOT NULL UNIQUE,
  sale_id         INTEGER NOT NULL REFERENCES sales (id),
  return_date     TEXT    NOT NULL CHECK (return_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  taxable_paise   INTEGER NOT NULL,
  cgst_paise      INTEGER NOT NULL,
  sgst_paise      INTEGER NOT NULL,
  igst_paise      INTEGER NOT NULL,
  round_off_paise INTEGER NOT NULL,
  total_paise     INTEGER NOT NULL CHECK (total_paise >= 0),
  reason          TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  cancel_reason   TEXT,
  created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_sales_returns_sale ON sales_returns (sale_id);
CREATE INDEX idx_sales_returns_date ON sales_returns (return_date, status);

CREATE TABLE sales_return_items (
  id              INTEGER PRIMARY KEY,
  sales_return_id INTEGER NOT NULL REFERENCES sales_returns (id),
  sale_item_id    INTEGER NOT NULL REFERENCES sale_items (id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  taxable_paise   INTEGER NOT NULL,
  cgst_paise      INTEGER NOT NULL,
  sgst_paise      INTEGER NOT NULL,
  igst_paise      INTEGER NOT NULL,
  total_paise     INTEGER NOT NULL,
  serials         TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(serials))
) STRICT;

ALTER TABLE product_units ADD COLUMN sale_item_id INTEGER REFERENCES sale_items (id);
ALTER TABLE product_units ADD COLUMN sales_return_id INTEGER REFERENCES sales_returns (id);
CREATE INDEX idx_product_units_sale_item ON product_units (sale_item_id);

-- Allow the new document types in the journal and stock tables (rebuild CHECKs).
CREATE TABLE journal_entries_new (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT    NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_type TEXT    NOT NULL CHECK (source_type IN ('purchase', 'purchase_return', 'sale', 'sales_return')),
  source_id   INTEGER NOT NULL,
  narration   TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  created_at  INTEGER NOT NULL,
  UNIQUE (source_type, source_id)
) STRICT;
INSERT INTO journal_entries_new SELECT * FROM journal_entries;

-- journal_lines references journal_entries; rebuild it against the new table.
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

CREATE TABLE stock_movements_new (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products (id),
  qty_delta   INTEGER NOT NULL CHECK (qty_delta <> 0),
  source_type TEXT    NOT NULL CHECK (source_type IN ('purchase', 'opening_stock', 'purchase_return', 'sale', 'sales_return')),
  source_id   INTEGER NOT NULL,
  is_void     INTEGER NOT NULL DEFAULT 0 CHECK (is_void IN (0, 1)),
  created_at  INTEGER NOT NULL
) STRICT;
INSERT INTO stock_movements_new SELECT * FROM stock_movements;
DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, is_void);
CREATE INDEX idx_stock_movements_source  ON stock_movements (source_type, source_id);
