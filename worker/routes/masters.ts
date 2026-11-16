import { Hono } from "hono";
import {
  createGstSlabSchema,
  listQuerySchema,
  normaliseCode,
  PAGE_SIZE,
  partySchema,
  productSchema,
  shopSettingsSchema,
  updateGstSlabSchema,
  updatePartySchema,
  updateProductSchema,
  type GstSlab,
  type ListResponse,
  type Party,
  type PartyType,
  type Product,
  type ScanResult,
  type DashboardSummary,
  type ShopSettings,
  type Unit,
} from "../../shared/masters";
import { todayIst } from "../../shared/gst";
import { conflict, diff, isUniqueViolation, likePattern, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { audit, auditIfChanged, idParam, nextStamp } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// ── Row mapping ──────────────────────────────────────────────────────────────

interface SettingsRow {
  shop_name: string;
  gstin: string | null;
  address: string;
  city: string;
  state_code: string;
  pincode: string;
  phone: string;
  email: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
  invoice_prefix: string;
  logo_data_url: string | null;
  updated_at: number;
}

const toSettings = (r: SettingsRow): ShopSettings => ({
  shopName: r.shop_name,
  gstin: r.gstin,
  address: r.address,
  city: r.city,
  stateCode: r.state_code,
  pincode: r.pincode,
  phone: r.phone,
  email: r.email,
  bankName: r.bank_name,
  bankAccount: r.bank_account,
  bankIfsc: r.bank_ifsc,
  invoicePrefix: r.invoice_prefix,
  logoDataUrl: r.logo_data_url,
  updatedAt: r.updated_at,
});

interface ProductRow {
  id: number;
  brand: string;
  name: string;
  category: string;
  hsn_code: string;
  gst_slab_id: number;
  rate_bp: number;
  unit: Unit;
  mrp_paise: number;
  selling_price_paise: number;
  barcode: string | null;
  tracks_serial: number;
  is_active: number;
  in_stock: number;
  updated_at: number;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.brand, p.name, p.category, p.hsn_code, p.gst_slab_id, g.rate_bp, p.unit,
         p.mrp_paise, p.selling_price_paise, p.barcode, p.tracks_serial, p.is_active, p.updated_at,
         CASE WHEN p.tracks_serial = 1
           THEN (SELECT COUNT(*) FROM product_units u WHERE u.product_id = p.id AND u.status = 'in_stock')
           ELSE (SELECT COALESCE(SUM(m.qty_delta), 0) FROM stock_movements m WHERE m.product_id = p.id AND m.is_void = 0)
         END AS in_stock
    FROM products p
    JOIN gst_slabs g ON g.id = p.gst_slab_id`;

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  brand: r.brand,
  name: r.name,
  category: r.category,
  hsnCode: r.hsn_code,
  gstSlabId: r.gst_slab_id,
  gstRateBp: r.rate_bp,
  unit: r.unit,
  mrpPaise: r.mrp_paise,
  sellingPricePaise: r.selling_price_paise,
  barcode: r.barcode,
  tracksSerial: r.tracks_serial === 1,
  isActive: r.is_active === 1,
  inStock: r.in_stock,
  updatedAt: r.updated_at,
});

interface PartyRow {
  id: number;
  name: string;
  party_type: PartyType;
  phone: string;
  email: string;
  gstin: string | null;
  address: string;
  city: string;
  state_code: string;
  pincode: string;
  opening_balance_paise: number;
  is_active: number;
  is_counter: number;
  updated_at: number;
}

const toParty = (r: PartyRow): Party => ({
  id: r.id,
  isCounter: r.is_counter === 1,
  name: r.name,
  partyType: r.party_type,
  phone: r.phone,
  email: r.email,
  gstin: r.gstin,
  address: r.address,
  city: r.city,
  stateCode: r.state_code,
  pincode: r.pincode,
  openingBalancePaise: r.opening_balance_paise,
  isActive: r.is_active === 1,
  updatedAt: r.updated_at,
});

async function getProduct(db: D1Database, id: number): Promise<Product | null> {
  const row = await db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?1`).bind(id).first<ProductRow>();
  return row ? toProduct(row) : null;
}

async function getParty(db: D1Database, id: number): Promise<Party | null> {
  const row = await db.prepare("SELECT * FROM parties WHERE id = ?1").bind(id).first<PartyRow>();
  return row ? toParty(row) : null;
}

async function assertSlabUsable(db: D1Database, slabId: number, currentSlabId?: number) {
  const slab = await db.prepare("SELECT is_active FROM gst_slabs WHERE id = ?1").bind(slabId).first<{ is_active: number }>();
  // A product may keep a slab that was retired after it was assigned.
  if (!slab || (slab.is_active !== 1 && slabId !== currentSlabId)) {
    throw new AppError(400, "VALIDATION", "Choose an active GST rate.", { fields: { gstSlabId: ["Choose an active GST rate"] } });
  }
}

function productUniqueError(err: unknown): never {
  if (isUniqueViolation(err, "products.barcode")) {
    throw new AppError(409, "DUPLICATE", "Another product already uses this barcode.", {
      fields: { barcode: ["Another product already uses this barcode"] },
    });
  }
  if (isUniqueViolation(err, "products.brand") || isUniqueViolation(err, "uq_products_brand_name")) {
    throw new AppError(409, "DUPLICATE", "A product with this brand and name already exists.", {
      fields: { name: ["A product with this brand and name already exists"] },
    });
  }
  throw err;
}

function partyUniqueError(err: unknown): never {
  if (isUniqueViolation(err, "parties.gstin")) {
    throw new AppError(409, "DUPLICATE", "Another party already has this GSTIN.", {
      fields: { gstin: ["Another party already has this GSTIN"] },
    });
  }
  throw err;
}

function paged<T>(items: T[], total: number, page: number): ListResponse<T> {
  return { items, total, page, pageSize: PAGE_SIZE };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const masterRoutes = new Hono<AppEnv>();
// Scoped to this module's paths: a bare "*" would also cover /api/auth/login once mounted at /api.
for (const path of ["/settings/*", "/gst-slabs", "/gst-slabs/*", "/products", "/products/*", "/parties", "/parties/*", "/scan/*", "/dashboard"]) {
  masterRoutes.use(path, requireAuth);
}
masterRoutes

  // Shop settings
  .get("/settings/shop", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM shop_settings WHERE id = 1").first<SettingsRow>();
    if (!row) throw notFound("Shop settings");
    return c.json(toSettings(row));
  })
  .put("/settings/shop", validate("json", shopSettingsSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const current = await db.prepare("SELECT * FROM shop_settings WHERE id = 1").first<SettingsRow>();
    if (!current) throw notFound("Shop settings");
    if (current.updated_at !== input.updatedAt) throw conflict();

    const stamp = nextStamp(current.updated_at);
    const [update] = await db.batch([
      db
        .prepare(
          `UPDATE shop_settings SET shop_name = ?1, gstin = ?2, address = ?3, city = ?4, state_code = ?5, pincode = ?6,
             phone = ?7, email = ?8, bank_name = ?9, bank_account = ?10, bank_ifsc = ?11, updated_at = ?12,
             invoice_prefix = ?14, logo_data_url = ?15
           WHERE id = 1 AND updated_at = ?13`,
        )
        .bind(
          input.shopName, input.gstin, input.address, input.city, input.stateCode, input.pincode,
          input.phone, input.email, input.bankName, input.bankAccount, input.bankIfsc, stamp, input.updatedAt,
          input.invoicePrefix, input.logoDataUrl,
        ),
      auditIfChanged(c, "settings.updated", {
        // The logo itself is not copied into the audit log, only whether it changed.
        changes: diff({ ...toSettings(current), logoDataUrl: current.logo_data_url ? "set" : null } as never, { ...input, logoDataUrl: input.logoDataUrl ? (input.logoDataUrl === current.logo_data_url ? "set" : "new") : null } as never),
      }),
    ]);
    if (!update?.meta.changes) throw conflict();
    const row = await db.prepare("SELECT * FROM shop_settings WHERE id = 1").first<SettingsRow>();
    return c.json(toSettings(row as SettingsRow));
  })

  // GST slabs
  .get("/gst-slabs", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT g.id, g.rate_bp, g.is_active, (SELECT COUNT(*) FROM products p WHERE p.gst_slab_id = g.id) AS product_count
         FROM gst_slabs g ORDER BY g.rate_bp`,
    ).all<{ id: number; rate_bp: number; is_active: number; product_count: number }>();
    const slabs: GstSlab[] = results.map((r) => ({
      id: r.id,
      rateBp: r.rate_bp,
      isActive: r.is_active === 1,
      productCount: r.product_count,
    }));
    return c.json({ items: slabs });
  })
  .post("/gst-slabs", validate("json", createGstSlabSchema), async (c) => {
    const rateBp = Math.round(c.req.valid("json").ratePercent * 100);
    const db = c.env.DB;
    try {
      const [insert] = await db.batch([
        db.prepare("INSERT INTO gst_slabs (rate_bp, created_at) VALUES (?1, ?2) RETURNING id").bind(rateBp, Date.now()),
        audit(c, "gst_slab.created", { rateBp }),
      ]);
      const id = (insert?.results[0] as { id: number } | undefined)?.id;
      const slab: GstSlab = { id: id ?? 0, rateBp, isActive: true, productCount: 0 };
      return c.json(slab, 201);
    } catch (err) {
      if (isUniqueViolation(err, "gst_slabs.rate_bp")) {
        throw new AppError(409, "DUPLICATE", "This GST rate already exists.", { fields: { ratePercent: ["Already exists"] } });
      }
      throw err;
    }
  })
  .patch("/gst-slabs/:id", validate("json", updateGstSlabSchema), async (c) => {
    const id = idParam(c);
    const { isActive } = c.req.valid("json");
    const db = c.env.DB;
    const [update] = await db.batch([
      db.prepare("UPDATE gst_slabs SET is_active = ?1 WHERE id = ?2").bind(isActive ? 1 : 0, id),
      auditIfChanged(c, "gst_slab.updated", { id, isActive }),
    ]);
    if (!update?.meta.changes) throw notFound("GST rate");
    return c.body(null, 204);
  })

  // Products
  .get("/products", validate("query", listQuerySchema), async (c) => {
    const { q, status, page } = c.req.valid("query");
    const where: string[] = [];
    const binds: unknown[] = [];
    if (status !== "all") {
      where.push(`p.is_active = ?${binds.length + 1}`);
      binds.push(status === "active" ? 1 : 0);
    }
    if (q) {
      const n = binds.length + 1;
      where.push(
        `(p.name LIKE ?${n} ESCAPE '\\' OR p.brand LIKE ?${n} ESCAPE '\\' OR p.category LIKE ?${n} ESCAPE '\\' OR p.hsn_code LIKE ?${n} ESCAPE '\\' OR p.barcode = ?${n + 1})`,
      );
      binds.push(likePattern(q), normaliseCode(q));
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const db = c.env.DB;
    const [rows, count] = await db.batch([
      db.prepare(`${PRODUCT_SELECT} ${clause} ORDER BY p.brand COLLATE NOCASE, p.name COLLATE NOCASE LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).bind(...binds),
      db.prepare(`SELECT COUNT(*) AS n FROM products p ${clause}`).bind(...binds),
    ]);
    const items = (rows?.results as unknown as ProductRow[]).map(toProduct);
    const total = (count?.results[0] as { n: number } | undefined)?.n ?? 0;
    return c.json(paged(items, total, page));
  })
  .get("/products/:id/units", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT serial FROM product_units WHERE product_id = ?1 AND status = 'in_stock' ORDER BY id LIMIT 500",
    )
      .bind(idParam(c))
      .all<{ serial: string }>();
    return c.json({ items: results.map((r) => r.serial) });
  })
  .get("/products/:id", async (c) => {
    const product = await getProduct(c.env.DB, idParam(c));
    if (!product) throw notFound("Product");
    return c.json(product);
  })
  .post("/products", validate("json", productSchema), async (c) => {
    const p = c.req.valid("json");
    const db = c.env.DB;
    await assertSlabUsable(db, p.gstSlabId);
    const now = Date.now();
    try {
      const [insert] = await db.batch([
        db
          .prepare(
            `INSERT INTO products (brand, name, category, hsn_code, gst_slab_id, unit, mrp_paise, selling_price_paise,
               barcode, tracks_serial, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12) RETURNING id`,
          )
          .bind(p.brand, p.name, p.category, p.hsnCode, p.gstSlabId, p.unit, p.mrpPaise, p.sellingPricePaise,
            p.barcode, p.tracksSerial ? 1 : 0, p.isActive ? 1 : 0, now),
        audit(c, "product.created", { brand: p.brand, name: p.name }),
      ]);
      const id = (insert?.results[0] as { id: number }).id;
      return c.json(await getProduct(db, id), 201);
    } catch (err) {
      productUniqueError(err);
    }
  })
  .put("/products/:id", validate("json", updateProductSchema), async (c) => {
    const id = idParam(c);
    const p = c.req.valid("json");
    const db = c.env.DB;
    const current = await getProduct(db, id);
    if (!current) throw notFound("Product");
    if (current.updatedAt !== p.updatedAt) throw conflict();
    await assertSlabUsable(db, p.gstSlabId, current.gstSlabId);
    if (current.tracksSerial && !p.tracksSerial && current.inStock > 0) {
      throw new AppError(400, "VALIDATION", "This product has serial-numbered units in stock.", {
        fields: { tracksSerial: ["Can't turn off serial tracking while serial-numbered units are in stock"] },
      });
    }
    const stamp = nextStamp(current.updatedAt);
    try {
      const [update] = await db.batch([
        db
          .prepare(
            `UPDATE products SET brand = ?1, name = ?2, category = ?3, hsn_code = ?4, gst_slab_id = ?5, unit = ?6,
               mrp_paise = ?7, selling_price_paise = ?8, barcode = ?9, tracks_serial = ?10, is_active = ?11, updated_at = ?12
             WHERE id = ?13 AND updated_at = ?14`,
          )
          .bind(p.brand, p.name, p.category, p.hsnCode, p.gstSlabId, p.unit, p.mrpPaise, p.sellingPricePaise,
            p.barcode, p.tracksSerial ? 1 : 0, p.isActive ? 1 : 0, stamp, id, p.updatedAt),
        auditIfChanged(c, "product.updated", { id, changes: diff(current as never, p as never) }),
      ]);
      if (!update?.meta.changes) throw conflict();
    } catch (err) {
      productUniqueError(err);
    }
    return c.json(await getProduct(db, id));
  })

  // Parties
  .get("/parties", validate("query", listQuerySchema), async (c) => {
    const { q, status, type, page } = c.req.valid("query");
    const where: string[] = [];
    const binds: unknown[] = [];
    if (status !== "all") {
      where.push(`is_active = ?${binds.length + 1}`);
      binds.push(status === "active" ? 1 : 0);
    }
    if (type) {
      // A "both" party appears in customer and supplier lists.
      where.push(`party_type IN (?${binds.length + 1}, 'both')`);
      binds.push(type);
    }
    if (q) {
      const n = binds.length + 1;
      where.push(`(name LIKE ?${n} ESCAPE '\\' OR phone LIKE ?${n} ESCAPE '\\' OR gstin LIKE ?${n} ESCAPE '\\' OR city LIKE ?${n} ESCAPE '\\')`);
      binds.push(likePattern(q));
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const db = c.env.DB;
    const [rows, count] = await db.batch([
      db.prepare(`SELECT * FROM parties ${clause} ORDER BY name COLLATE NOCASE LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).bind(...binds),
      db.prepare(`SELECT COUNT(*) AS n FROM parties ${clause}`).bind(...binds),
    ]);
    const items = (rows?.results as unknown as PartyRow[]).map(toParty);
    const total = (count?.results[0] as { n: number } | undefined)?.n ?? 0;
    return c.json(paged(items, total, page));
  })
  .get("/parties/:id", async (c) => {
    const party = await getParty(c.env.DB, idParam(c));
    if (!party) throw notFound("Party");
    return c.json(party);
  })
  .post("/parties", validate("json", partySchema), async (c) => {
    const p = c.req.valid("json");
    const db = c.env.DB;
    const now = Date.now();
    try {
      const [insert] = await db.batch([
        db
          .prepare(
            `INSERT INTO parties (name, party_type, phone, email, gstin, address, city, state_code, pincode,
               opening_balance_paise, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12) RETURNING id`,
          )
          .bind(p.name, p.partyType, p.phone, p.email, p.gstin, p.address, p.city, p.stateCode, p.pincode,
            p.openingBalancePaise, p.isActive ? 1 : 0, now),
        audit(c, "party.created", { name: p.name, openingBalancePaise: p.openingBalancePaise }),
      ]);
      const id = (insert?.results[0] as { id: number }).id;
      return c.json(await getParty(db, id), 201);
    } catch (err) {
      partyUniqueError(err);
    }
  })
  .put("/parties/:id", validate("json", updatePartySchema), async (c) => {
    const id = idParam(c);
    const p = c.req.valid("json");
    const db = c.env.DB;
    const current = await getParty(db, id);
    if (!current) throw notFound("Party");
    if (current.updatedAt !== p.updatedAt) throw conflict();
    if (current.isCounter && (p.partyType !== "customer" || !p.isActive || p.gstin || p.openingBalancePaise !== 0)) {
      throw new AppError(400, "VALIDATION", "The Counter Sales customer must stay an active customer without GSTIN or opening balance.");
    }
    const stamp = nextStamp(current.updatedAt);
    try {
      const [update] = await db.batch([
        db
          .prepare(
            `UPDATE parties SET name = ?1, party_type = ?2, phone = ?3, email = ?4, gstin = ?5, address = ?6, city = ?7,
               state_code = ?8, pincode = ?9, opening_balance_paise = ?10, is_active = ?11, updated_at = ?12
             WHERE id = ?13 AND updated_at = ?14`,
          )
          .bind(p.name, p.partyType, p.phone, p.email, p.gstin, p.address, p.city, p.stateCode, p.pincode,
            p.openingBalancePaise, p.isActive ? 1 : 0, stamp, id, p.updatedAt),
        auditIfChanged(c, "party.updated", { id, changes: diff(current as never, p as never) }),
      ]);
      if (!update?.meta.changes) throw conflict();
    } catch (err) {
      partyUniqueError(err);
    }
    return c.json(await getParty(db, id));
  })

  // Dashboard summary (grows with each module)
  .get("/dashboard", async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE is_active = 1) AS active_products,
         (SELECT COUNT(*) FROM product_units WHERE status = 'in_stock') AS units_in_stock,
         (SELECT COUNT(*) FROM parties WHERE is_active = 1) AS active_parties,
         (SELECT COALESCE(SUM(opening_balance_paise), 0) FROM parties WHERE opening_balance_paise > 0) AS receivable_paise,
         (SELECT COALESCE(-SUM(opening_balance_paise), 0) FROM parties WHERE opening_balance_paise < 0) AS payable_paise,
         (SELECT COALESCE(SUM(total_paise), 0) FROM sales WHERE status = 'posted' AND invoice_date = ?1) AS sales_today,
         (SELECT COUNT(*) FROM sales WHERE status = 'posted' AND invoice_date = ?1) AS sales_today_count`,
    ).bind(todayIst()).first<{ active_products: number; units_in_stock: number; active_parties: number; receivable_paise: number; payable_paise: number; sales_today: number; sales_today_count: number }>();
    const summary: DashboardSummary = {
      activeProducts: row?.active_products ?? 0,
      unitsInStock: row?.units_in_stock ?? 0,
      activeParties: row?.active_parties ?? 0,
      salesTodayPaise: row?.sales_today ?? 0,
      salesTodayCount: row?.sales_today_count ?? 0,
      receivablePaise: row?.receivable_paise ?? 0,
      payablePaise: row?.payable_paise ?? 0,
    };
    return c.json(summary);
  })

  // Barcode / serial lookup used by every scan box
  .get("/scan/:code", async (c) => {
    const code = normaliseCode(decodeURIComponent(c.req.param("code")));
    const db = c.env.DB;
    if (!code || code.length > 64) return c.json({ kind: "none", code } satisfies ScanResult);

    const unit = await db
      .prepare("SELECT serial, status, product_id FROM product_units WHERE serial = ?1 ORDER BY status = 'void', id DESC LIMIT 1")
      .bind(code)
      .first<{ serial: string; status: string; product_id: number }>();
    if (unit) {
      const product = await getProduct(db, unit.product_id);
      if (product) return c.json({ kind: "unit", serial: unit.serial, status: unit.status, product } satisfies ScanResult);
    }
    const row = await db.prepare(`${PRODUCT_SELECT} WHERE p.barcode = ?1`).bind(code).first<ProductRow>();
    if (row) return c.json({ kind: "product", product: toProduct(row) } satisfies ScanResult);
    return c.json({ kind: "none", code } satisfies ScanResult);
  });
