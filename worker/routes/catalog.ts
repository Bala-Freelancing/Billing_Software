// Product groups and product units (Module 7).
//
// What can go wrong and how it is handled:
// - Renaming a group must not orphan products: products.category is updated in
//   the same batch, and a guard checks no product is left on the old name.
// - Unit codes are stored on products and printed on invoices, so a code never
//   changes once created; only its name and active flag can.
// - Deactivating hides a group/unit from new products; existing products keep it.
// - Concurrent edits: optimistic locking on updated_at (409).
import { Hono } from "hono";
import { productGroupSchema, unitSchema, updateProductGroupSchema, updateUnitSchema, type ProductGroup, type UnitRow } from "../../shared/catalog";
import { conflict, isUniqueViolation, notFound } from "../lib/db";
import { AppError } from "../lib/errors";
import { clearGuards, guard, isGuardFailure } from "../lib/guard";
import { audit, auditIfChanged, nextStamp } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const invalid = (message: string, field: string) => new AppError(400, "VALIDATION", message, { fields: { [field]: [message] } });

const groupSelect = `SELECT g.*, (SELECT COUNT(*) FROM products p WHERE p.category = g.name) AS product_count FROM product_groups g`;
const toGroup = (r: Row): ProductGroup => ({ id: r.id, name: r.name, isActive: r.is_active === 1, productCount: r.product_count, updatedAt: r.updated_at });
const getGroup = async (db: D1Database, id: number) => {
  const r = await db.prepare(`${groupSelect} WHERE g.id = ?1`).bind(id).first<Row>();
  return r ? toGroup(r) : null;
};

const unitSelect = `SELECT u.*, (SELECT COUNT(*) FROM products p WHERE p.unit = u.code) AS product_count FROM units u`;
const toUnit = (r: Row): UnitRow => ({ code: r.code, name: r.name, isSystem: r.is_system === 1, isActive: r.is_active === 1, productCount: r.product_count, updatedAt: r.updated_at });
const getUnit = async (db: D1Database, code: string) => {
  const r = await db.prepare(`${unitSelect} WHERE u.code = ?1`).bind(code).first<Row>();
  return r ? toUnit(r) : null;
};

const intParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound("Record");
  return n;
};

export const catalogRoutes = new Hono<AppEnv>();
for (const path of ["/product-groups", "/product-groups/*", "/units", "/units/*"]) catalogRoutes.use(path, requireAuth);

catalogRoutes
  .get("/product-groups", async (c) => {
    const { results } = await c.env.DB.prepare(`${groupSelect} ORDER BY g.name COLLATE NOCASE LIMIT 1000`).all<Row>();
    return c.json({ items: results.map(toGroup) });
  })

  .post("/product-groups", validate("json", productGroupSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const now = Date.now();
    try {
      const [ins] = await db.batch([
        db.prepare("INSERT INTO product_groups (name, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) RETURNING id").bind(input.name, input.isActive ? 1 : 0, now),
        audit(c, "product_group.created", { name: input.name }),
      ]);
      return c.json(await getGroup(db, (ins?.results?.[0] as { id: number }).id), 201);
    } catch (err) {
      if (isUniqueViolation(err, "product_groups.name")) throw invalid("A group with this name already exists", "name");
      throw err;
    }
  })

  .put("/product-groups/:id", validate("json", updateProductGroupSchema), async (c) => {
    const id = intParam(c.req.param("id"));
    const input = c.req.valid("json");
    const db = c.env.DB;
    const current = await getGroup(db, id);
    if (!current) throw notFound("Product group");
    if (current.updatedAt !== input.updatedAt) throw conflict();
    try {
      const [update] = await db.batch([
        db
          .prepare("UPDATE product_groups SET name = ?1, is_active = ?2, updated_at = ?3 WHERE id = ?4 AND updated_at = ?5")
          .bind(input.name, input.isActive ? 1 : 0, nextStamp(current.updatedAt), id, input.updatedAt),
        auditIfChanged(c, "product_group.updated", { id, from: { name: current.name, isActive: current.isActive }, to: { name: input.name, isActive: input.isActive } }),
        // Products follow the rename (same transaction).
        db.prepare("UPDATE products SET category = ?1 WHERE category = ?2 AND ?1 <> ?2").bind(input.name, current.name),
        guard(db, "?1 = ?2 OR NOT EXISTS (SELECT 1 FROM products WHERE category = ?2)", input.name, current.name),
        clearGuards(db),
      ]);
      if (!update?.meta.changes) throw conflict();
    } catch (err) {
      if (isUniqueViolation(err, "product_groups.name")) throw invalid("A group with this name already exists", "name");
      if (isGuardFailure(err)) throw conflict();
      throw err;
    }
    return c.json(await getGroup(db, id));
  })

  .get("/units", async (c) => {
    const { results } = await c.env.DB.prepare(`${unitSelect} ORDER BY u.is_system DESC, u.code LIMIT 500`).all<Row>();
    return c.json({ items: results.map(toUnit) });
  })

  .post("/units", validate("json", unitSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;
    const now = Date.now();
    try {
      await db.batch([
        db.prepare("INSERT INTO units (code, name, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)").bind(input.code, input.name, input.isActive ? 1 : 0, now),
        audit(c, "unit.created", { code: input.code, name: input.name }),
      ]);
    } catch (err) {
      if (isUniqueViolation(err, "units.code")) throw invalid("This unit code already exists", "code");
      throw err;
    }
    return c.json(await getUnit(db, input.code), 201);
  })

  .put("/units/:code", validate("json", updateUnitSchema), async (c) => {
    const code = c.req.param("code").toUpperCase();
    const input = c.req.valid("json");
    const db = c.env.DB;
    const current = await getUnit(db, code);
    if (!current) throw notFound("Unit");
    if (current.updatedAt !== input.updatedAt) throw conflict();
    const [update] = await db.batch([
      db
        .prepare("UPDATE units SET name = ?1, is_active = ?2, updated_at = ?3 WHERE code = ?4 AND updated_at = ?5")
        .bind(input.name, input.isActive ? 1 : 0, nextStamp(current.updatedAt), code, input.updatedAt),
      auditIfChanged(c, "unit.updated", { code, from: { name: current.name, isActive: current.isActive }, to: { name: input.name, isActive: input.isActive } }),
    ]);
    if (!update?.meta.changes) throw conflict();
    return c.json(await getUnit(db, code));
  });
