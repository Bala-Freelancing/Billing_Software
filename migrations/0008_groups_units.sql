-- Module 7: ledger sub-groups, product groups and product units masters.
-- Backward-compatible: the previous release keeps reading/writing the same
-- columns (products.category / products.unit stay plain text).

-- ── Ledger groups: owner-created sub-groups under a built-in group ──────────
ALTER TABLE ledger_groups ADD COLUMN parent_id  INTEGER REFERENCES ledger_groups (id);
ALTER TABLE ledger_groups ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_groups ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_ledger_groups_parent ON ledger_groups (parent_id);

-- ── Product groups ──────────────────────────────────────────────────────────
-- products.category holds the group's name (renames update products in the
-- same batch), so older code and existing reports keep working unchanged.
CREATE TABLE product_groups (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 60),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO product_groups (name, created_at, updated_at)
SELECT category, 0, 0 FROM products WHERE category <> '' GROUP BY category COLLATE NOCASE;
-- Line existing products up with the stored group spelling.
UPDATE products SET category = (SELECT g.name FROM product_groups g WHERE g.name = products.category COLLATE NOCASE) WHERE category <> '';

-- ── Product units ───────────────────────────────────────────────────────────
CREATE TABLE units (
  code       TEXT    PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 8 AND code = upper(code) AND code NOT GLOB '*[^A-Z0-9]*'),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  is_system  INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO units (code, name, is_system, created_at, updated_at) VALUES
  ('PCS', 'Pieces', 1, 0, 0), ('NOS', 'Numbers', 1, 0, 0), ('SET', 'Sets', 1, 0, 0), ('BOX', 'Boxes', 1, 0, 0),
  ('PKT', 'Packets', 1, 0, 0), ('MTR', 'Metres', 1, 0, 0), ('COIL', 'Coils', 1, 0, 0);

-- products.unit had a fixed CHECK list; rebuild without it so new units can be
-- used. Same columns and order; child tables keep referencing "products".
PRAGMA defer_foreign_keys = true;
CREATE TABLE products_new (
  id                  INTEGER PRIMARY KEY,
  brand               TEXT    NOT NULL CHECK (length(brand) BETWEEN 1 AND 60),
  name                TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  category            TEXT    NOT NULL DEFAULT '',
  hsn_code            TEXT    NOT NULL CHECK (length(hsn_code) IN (4, 6, 8) AND hsn_code NOT GLOB '*[^0-9]*'),
  gst_slab_id         INTEGER NOT NULL REFERENCES gst_slabs (id),
  unit                TEXT    NOT NULL REFERENCES units (code),
  mrp_paise           INTEGER NOT NULL CHECK (mrp_paise >= 0),
  selling_price_paise INTEGER NOT NULL CHECK (selling_price_paise >= 0 AND selling_price_paise <= mrp_paise),
  barcode             TEXT    UNIQUE,
  tracks_serial       INTEGER NOT NULL DEFAULT 1 CHECK (tracks_serial IN (0, 1)),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;
INSERT INTO products_new SELECT * FROM products;
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;
CREATE UNIQUE INDEX uq_products_brand_name ON products (brand COLLATE NOCASE, name COLLATE NOCASE);
CREATE INDEX idx_products_name ON products (name COLLATE NOCASE);
CREATE INDEX idx_products_category ON products (category);
CREATE INDEX idx_products_unit ON products (unit);
PRAGMA defer_foreign_keys = false;
