-- Module 2: shop settings, GST slabs, products, serial-number register, parties.
-- Money is integer paise. GST rates are integer basis points (18% = 1800).

-- Exactly one row (id = 1).
CREATE TABLE shop_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  shop_name     TEXT    NOT NULL CHECK (length(shop_name) BETWEEN 1 AND 120),
  gstin         TEXT    CHECK (gstin IS NULL OR length(gstin) = 15),
  address       TEXT    NOT NULL DEFAULT '',
  city          TEXT    NOT NULL DEFAULT '',
  state_code    TEXT    NOT NULL CHECK (length(state_code) = 2),
  pincode       TEXT    NOT NULL DEFAULT '',
  phone         TEXT    NOT NULL DEFAULT '',
  email         TEXT    NOT NULL DEFAULT '',
  bank_name     TEXT    NOT NULL DEFAULT '',
  bank_account  TEXT    NOT NULL DEFAULT '',
  bank_ifsc     TEXT    NOT NULL DEFAULT '',
  updated_at    INTEGER NOT NULL
) STRICT;

INSERT INTO shop_settings (id, shop_name, state_code, updated_at)
VALUES (1, 'Sri Vishnu Communication', '33', 0);

CREATE TABLE gst_slabs (
  id         INTEGER PRIMARY KEY,
  rate_bp    INTEGER NOT NULL UNIQUE CHECK (rate_bp BETWEEN 0 AND 10000),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

-- A rate is part of history once used; it can be retired, never changed.
CREATE TRIGGER gst_slabs_rate_immutable BEFORE UPDATE OF rate_bp ON gst_slabs
WHEN NEW.rate_bp <> OLD.rate_bp
BEGIN
  SELECT RAISE(ABORT, 'gst_slabs.rate_bp cannot be changed');
END;

INSERT INTO gst_slabs (rate_bp, created_at) VALUES (0, 0), (500, 0), (1200, 0), (1800, 0), (2800, 0);

CREATE TABLE products (
  id                  INTEGER PRIMARY KEY,
  brand               TEXT    NOT NULL CHECK (length(brand) BETWEEN 1 AND 60),
  name                TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  category            TEXT    NOT NULL DEFAULT '',
  hsn_code            TEXT    NOT NULL CHECK (length(hsn_code) IN (4, 6, 8) AND hsn_code NOT GLOB '*[^0-9]*'),
  gst_slab_id         INTEGER NOT NULL REFERENCES gst_slabs (id),
  unit                TEXT    NOT NULL CHECK (unit IN ('PCS', 'NOS', 'SET', 'BOX', 'PKT', 'MTR', 'COIL')),
  -- Both prices include GST. Selling price may not exceed MRP.
  mrp_paise           INTEGER NOT NULL CHECK (mrp_paise >= 0),
  selling_price_paise INTEGER NOT NULL CHECK (selling_price_paise >= 0 AND selling_price_paise <= mrp_paise),
  barcode             TEXT    UNIQUE,
  tracks_serial       INTEGER NOT NULL DEFAULT 1 CHECK (tracks_serial IN (0, 1)),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX uq_products_brand_name ON products (brand COLLATE NOCASE, name COLLATE NOCASE);
CREATE INDEX idx_products_name ON products (name COLLATE NOCASE);

-- One row per physical unit. Filled by purchase entry (Module 3), consumed by
-- sales (Module 4). Serials are stored normalised (upper case, no spaces).
CREATE TABLE product_units (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  serial     TEXT    NOT NULL UNIQUE CHECK (length(serial) BETWEEN 1 AND 64),
  status     TEXT    NOT NULL CHECK (status IN ('in_stock', 'sold', 'returned_to_supplier', 'damaged')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_product_units_product_status ON product_units (product_id, status);

CREATE TABLE parties (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  party_type            TEXT    NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both')),
  phone                 TEXT    NOT NULL DEFAULT '',
  email                 TEXT    NOT NULL DEFAULT '',
  gstin                 TEXT    UNIQUE CHECK (gstin IS NULL OR length(gstin) = 15),
  address               TEXT    NOT NULL DEFAULT '',
  city                  TEXT    NOT NULL DEFAULT '',
  state_code            TEXT    NOT NULL CHECK (length(state_code) = 2),
  pincode               TEXT    NOT NULL DEFAULT '',
  -- Positive: the party owes the shop. Negative: the shop owes the party.
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_parties_name ON parties (name COLLATE NOCASE);
CREATE INDEX idx_parties_type ON parties (party_type, is_active);
