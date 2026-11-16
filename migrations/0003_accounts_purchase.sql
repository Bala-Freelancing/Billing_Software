-- Module 3: double-entry accounting core, purchases, opening stock, purchase returns.
-- Dates of documents are ISO 'YYYY-MM-DD' (the date printed on the bill, IST).
-- Every document carries a client-generated `uid` used as an idempotency key, so
-- a double-clicked "Save" can never create the same bill twice.

-- ── Chart of accounts ────────────────────────────────────────────────────────

CREATE TABLE ledger_groups (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  nature TEXT NOT NULL CHECK (nature IN ('asset', 'liability', 'income', 'expense')),
  system_key TEXT UNIQUE
) STRICT;

INSERT INTO ledger_groups (name, nature, system_key) VALUES
  ('Sundry Debtors',    'asset',     'sundry_debtors'),
  ('Sundry Creditors',  'liability', 'sundry_creditors'),
  ('Cash-in-Hand',      'asset',     'cash'),
  ('Bank Accounts',     'asset',     'bank'),
  ('Stock-in-Hand',     'asset',     'stock'),
  ('Duties & Taxes',    'liability', 'duties_taxes'),
  ('Capital Account',   'liability', 'capital'),
  ('Purchase Accounts', 'expense',   'purchase_accounts'),
  ('Sales Accounts',    'income',    'sales_accounts'),
  ('Direct Expenses',   'expense',   'direct_expenses'),
  ('Indirect Expenses', 'expense',   'indirect_expenses'),
  ('Indirect Incomes',  'income',    'indirect_incomes');

CREATE TABLE ledgers (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  group_id   INTEGER NOT NULL REFERENCES ledger_groups (id),
  system_key TEXT    UNIQUE,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

INSERT INTO ledgers (name, group_id, system_key, created_at) VALUES
  ('Purchase',          (SELECT id FROM ledger_groups WHERE system_key = 'purchase_accounts'), 'purchase',        0),
  ('Purchase Returns',  (SELECT id FROM ledger_groups WHERE system_key = 'purchase_accounts'), 'purchase_return', 0),
  ('Sales',             (SELECT id FROM ledger_groups WHERE system_key = 'sales_accounts'),    'sales',           0),
  ('Sales Returns',     (SELECT id FROM ledger_groups WHERE system_key = 'sales_accounts'),    'sales_return',    0),
  ('Input CGST',        (SELECT id FROM ledger_groups WHERE system_key = 'duties_taxes'),      'input_cgst',      0),
  ('Input SGST',        (SELECT id FROM ledger_groups WHERE system_key = 'duties_taxes'),      'input_sgst',      0),
  ('Input IGST',        (SELECT id FROM ledger_groups WHERE system_key = 'duties_taxes'),      'input_igst',      0),
  ('Output CGST',       (SELECT id FROM ledger_groups WHERE system_key = 'duties_taxes'),      'output_cgst',     0),
  ('Output SGST',       (SELECT id FROM ledger_groups WHERE system_key = 'duties_taxes'),      'output_sgst',     0),
  ('Output IGST',       (SELECT id FROM ledger_groups WHERE system_key = 'duties_taxes'),      'output_igst',     0),
  ('Round Off',         (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 'round_off',       0),
  ('Cash',              (SELECT id FROM ledger_groups WHERE system_key = 'cash'),              'cash',            0),
  ('Discount Allowed',  (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 'discount_allowed',  0),
  ('Discount Received', (SELECT id FROM ledger_groups WHERE system_key = 'indirect_incomes'),  'discount_received', 0);

-- One journal entry per posted document. Cancelling a document marks its entry
-- cancelled; reports ignore cancelled entries. Nothing is deleted.
CREATE TABLE journal_entries (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT    NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_type TEXT    NOT NULL CHECK (source_type IN ('purchase', 'purchase_return')),
  source_id   INTEGER NOT NULL,
  narration   TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  created_at  INTEGER NOT NULL,
  UNIQUE (source_type, source_id)
) STRICT;

CREATE INDEX idx_journal_entries_date ON journal_entries (entry_date, status);

-- Each line hits exactly one ledger OR one party (parties act as their own ledgers).
CREATE TABLE journal_lines (
  id           INTEGER PRIMARY KEY,
  entry_id     INTEGER NOT NULL REFERENCES journal_entries (id),
  ledger_id    INTEGER REFERENCES ledgers (id),
  party_id     INTEGER REFERENCES parties (id),
  debit_paise  INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  CHECK ((ledger_id IS NULL) <> (party_id IS NULL)),
  CHECK ((debit_paise = 0) <> (credit_paise = 0))
) STRICT;

CREATE INDEX idx_journal_lines_entry  ON journal_lines (entry_id);
CREATE INDEX idx_journal_lines_ledger ON journal_lines (ledger_id);
CREATE INDEX idx_journal_lines_party  ON journal_lines (party_id);

-- ── Purchases ────────────────────────────────────────────────────────────────

CREATE TABLE purchases (
  id                  INTEGER PRIMARY KEY,
  uid                 TEXT    NOT NULL UNIQUE,
  supplier_id         INTEGER NOT NULL REFERENCES parties (id),
  supplier_invoice_no TEXT    NOT NULL CHECK (length(supplier_invoice_no) BETWEEN 1 AND 40),
  invoice_date        TEXT    NOT NULL CHECK (invoice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  is_interstate       INTEGER NOT NULL CHECK (is_interstate IN (0, 1)),
  rates_include_gst   INTEGER NOT NULL CHECK (rates_include_gst IN (0, 1)),
  taxable_paise       INTEGER NOT NULL,
  cgst_paise          INTEGER NOT NULL,
  sgst_paise          INTEGER NOT NULL,
  igst_paise          INTEGER NOT NULL,
  round_off_paise     INTEGER NOT NULL,
  total_paise         INTEGER NOT NULL CHECK (total_paise >= 0),
  notes               TEXT    NOT NULL DEFAULT '',
  status              TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  cancel_reason       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;

-- The same supplier invoice must not be entered twice (cancelled ones excepted).
CREATE UNIQUE INDEX uq_purchases_supplier_invoice
  ON purchases (supplier_id, supplier_invoice_no COLLATE NOCASE) WHERE status = 'posted';
CREATE INDEX idx_purchases_date ON purchases (invoice_date, status);
CREATE INDEX idx_purchases_supplier ON purchases (supplier_id, invoice_date);

CREATE TABLE purchase_items (
  id            INTEGER PRIMARY KEY,
  purchase_id   INTEGER NOT NULL REFERENCES purchases (id),
  line_no       INTEGER NOT NULL,
  product_id    INTEGER NOT NULL REFERENCES products (id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  rate_paise    INTEGER NOT NULL CHECK (rate_paise >= 0),
  gst_rate_bp   INTEGER NOT NULL CHECK (gst_rate_bp BETWEEN 0 AND 10000),
  taxable_paise INTEGER NOT NULL,
  cgst_paise    INTEGER NOT NULL,
  sgst_paise    INTEGER NOT NULL,
  igst_paise    INTEGER NOT NULL,
  total_paise   INTEGER NOT NULL,
  UNIQUE (purchase_id, line_no)
) STRICT;

CREATE INDEX idx_purchase_items_product ON purchase_items (product_id);

-- Opening stock: units already in the shop before the software was used.
CREATE TABLE opening_stock (
  id         INTEGER PRIMARY KEY,
  uid        TEXT    NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
  status     TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE purchase_returns (
  id              INTEGER PRIMARY KEY,
  uid             TEXT    NOT NULL UNIQUE,
  purchase_id     INTEGER NOT NULL REFERENCES purchases (id),
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

CREATE INDEX idx_purchase_returns_purchase ON purchase_returns (purchase_id);

CREATE TABLE purchase_return_items (
  id                 INTEGER PRIMARY KEY,
  purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns (id),
  purchase_item_id   INTEGER NOT NULL REFERENCES purchase_items (id),
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  taxable_paise      INTEGER NOT NULL,
  cgst_paise         INTEGER NOT NULL,
  sgst_paise         INTEGER NOT NULL,
  igst_paise         INTEGER NOT NULL,
  total_paise        INTEGER NOT NULL
) STRICT;

-- ── Stock ────────────────────────────────────────────────────────────────────

-- Every quantity change for every product (serial or not). Stock = SUM(qty_delta)
-- over posted movements; cancelling a document adds no rows, it voids its own.
CREATE TABLE stock_movements (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products (id),
  qty_delta   INTEGER NOT NULL CHECK (qty_delta <> 0),
  source_type TEXT    NOT NULL CHECK (source_type IN ('purchase', 'opening_stock', 'purchase_return')),
  source_id   INTEGER NOT NULL,
  is_void     INTEGER NOT NULL DEFAULT 0 CHECK (is_void IN (0, 1)),
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, is_void);
CREATE INDEX idx_stock_movements_source  ON stock_movements (source_type, source_id);

-- Rebuild product_units: link each unit to where it came from, add 'void' for
-- units of cancelled documents, and make serials unique among live units only so a
-- serial from a cancelled purchase can be entered again. Table was empty until now.
CREATE TABLE product_units_new (
  id                 INTEGER PRIMARY KEY,
  product_id         INTEGER NOT NULL REFERENCES products (id),
  serial             TEXT    NOT NULL CHECK (length(serial) BETWEEN 1 AND 64),
  status             TEXT    NOT NULL CHECK (status IN ('in_stock', 'sold', 'returned_to_supplier', 'damaged', 'void')),
  purchase_item_id   INTEGER REFERENCES purchase_items (id),
  opening_stock_id   INTEGER REFERENCES opening_stock (id),
  purchase_return_id INTEGER REFERENCES purchase_returns (id),
  cost_paise         INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
) STRICT;

INSERT INTO product_units_new (id, product_id, serial, status, created_at, updated_at)
  SELECT id, product_id, serial, status, created_at, updated_at FROM product_units;
DROP TABLE product_units;
ALTER TABLE product_units_new RENAME TO product_units;

CREATE UNIQUE INDEX uq_product_units_live_serial ON product_units (serial) WHERE status <> 'void';
CREATE INDEX idx_product_units_product_status ON product_units (product_id, status);
CREATE INDEX idx_product_units_purchase_item ON product_units (purchase_item_id);
