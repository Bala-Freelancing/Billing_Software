import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProductGroup, UnitRow } from "../shared/catalog";
import type { LedgerGroupRow, Ledger } from "../shared/ledgers";
import type { GstSlab, Product } from "../shared/masters";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
let slabId: number;
let n = 0;

const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
const put = (path: string, body: unknown) => call(env, path, { method: "PUT", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const product = (o: Record<string, unknown>) =>
  post("/api/products", { brand: "Havells", name: `Item ${++n}`, category: "", hsnCode: "8414", gstSlabId: slabId, unit: "PCS", mrpPaise: 1000, sellingPricePaise: 900, barcode: "", tracksSerial: false, isActive: true, ...o });

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  slabId = (await json<{ items: GstSlab[] }>(await get("/api/gst-slabs"))).items.find((s) => s.rateBp === 1800)!.id;
});
afterAll(async () => {
  await ctx.dispose();
});

describe("product groups", () => {
  it("creates groups, assigns products and follows renames", async () => {
    const g = await json<ProductGroup>(await post("/api/product-groups", { name: "Ceiling Fans", isActive: true }));
    expect(await errorCode(await post("/api/product-groups", { name: "ceiling fans", isActive: true }))).toBe("VALIDATION");
    // Group name is matched case-insensitively and stored in the group's spelling.
    const p = await json<Product>(await product({ category: "ceiling FANS" }));
    expect(p.category).toBe("Ceiling Fans");
    expect(await errorCode(await product({ category: "Unknown Group" }))).toBe("VALIDATION");

    const renamed = await json<ProductGroup>(await put(`/api/product-groups/${g.id}`, { name: "Fans – Ceiling", isActive: true, updatedAt: g.updatedAt }));
    expect(renamed.productCount).toBe(1);
    expect((await json<Product>(await get(`/api/products/${p.id}`))).category).toBe("Fans – Ceiling");
    expect(await errorCode(await put(`/api/product-groups/${g.id}`, { name: "X", isActive: true, updatedAt: g.updatedAt }))).toBe("CONFLICT");
    // The product list filters by group.
    const inGroup = await json<{ items: Product[] }>(await get(`/api/products?group=${encodeURIComponent("Fans – Ceiling")}`));
    expect(inGroup.items.map((x) => x.id)).toEqual([p.id]);
  });

  it("hides inactive groups from new products but keeps them on existing ones", async () => {
    const g = await json<ProductGroup>(await post("/api/product-groups", { name: "Old Range", isActive: true }));
    const p = await json<Product>(await product({ category: "Old Range" }));
    await json(await put(`/api/product-groups/${g.id}`, { name: "Old Range", isActive: false, updatedAt: g.updatedAt }));
    expect(await errorCode(await product({ category: "Old Range" }))).toBe("VALIDATION");
    const { inStock: _s, gstRateBp: _r, id: _i, ...rest } = p;
    expect((await put(`/api/products/${p.id}`, { ...rest, mrpPaise: 2000 })).status).toBe(200);
  });
});

describe("units", () => {
  it("lists built-in units and adds new ones usable on products", async () => {
    const list = await json<{ items: UnitRow[] }>(await get("/api/units"));
    expect(list.items.find((u) => u.code === "COIL")).toMatchObject({ isSystem: true, isActive: true });
    const u = await json<UnitRow>(await post("/api/units", { code: "roll", name: "Rolls", isActive: true }));
    expect(u.code).toBe("ROLL");
    expect(await errorCode(await post("/api/units", { code: "ROLL", name: "Again", isActive: true }))).toBe("VALIDATION");
    expect(await errorCode(await post("/api/units", { code: "BAD CODE", name: "x", isActive: true }))).toBe("VALIDATION");
    const p = await json<Product>(await product({ unit: "ROLL" }));
    expect(p.unit).toBe("ROLL");
    expect(await errorCode(await product({ unit: "KG" }))).toBe("VALIDATION");

    const off = await json<UnitRow>(await put("/api/units/ROLL", { name: "Rolls", isActive: false, updatedAt: u.updatedAt }));
    expect(off).toMatchObject({ isActive: false, productCount: 1 });
    expect(await errorCode(await product({ unit: "ROLL" }))).toBe("VALIDATION");
  });
});

describe("ledger groups", () => {
  it("adds sub-groups that inherit the parent's nature and can hold ledgers", async () => {
    const groups = (await json<{ items: LedgerGroupRow[] }>(await get("/api/ledger-groups"))).items;
    const indirect = groups.find((g) => g.systemKey === "indirect_expenses")!;
    const debtors = groups.find((g) => g.systemKey === "sundry_debtors")!;
    const sub = await json<LedgerGroupRow>(await post("/api/ledger-groups", { name: "Vehicle Expenses", parentId: indirect.id }));
    expect(sub).toMatchObject({ nature: "expense", parentName: "Indirect Expenses", isSystem: false, allowsLedgers: true });
    expect(await errorCode(await post("/api/ledger-groups", { name: "Area A", parentId: debtors.id }))).toBe("VALIDATION");
    expect(await errorCode(await post("/api/ledger-groups", { name: "Nested", parentId: sub.id }))).toBe("VALIDATION");
    expect(await errorCode(await post("/api/ledger-groups", { name: "vehicle expenses", parentId: indirect.id }))).toBe("VALIDATION");

    const fuel = await json<Ledger>(await post("/api/ledgers", { name: "Fuel", groupId: sub.id, isActive: true }));
    expect(fuel).toMatchObject({ nature: "expense", groupName: "Vehicle Expenses" });
    const renamed = await json<LedgerGroupRow>(await put(`/api/ledger-groups/${sub.id}`, { name: "Vehicle Running", updatedAt: sub.updatedAt }));
    expect(renamed.ledgerCount).toBe(1);
    expect(await errorCode(await put(`/api/ledger-groups/${indirect.id}`, { name: "Renamed", updatedAt: indirect.updatedAt }))).toBe("SYSTEM_GROUP");
  });

  it("audits master changes and needs login", async () => {
    const a = await env.DB.prepare("SELECT GROUP_CONCAT(DISTINCT action) AS a FROM audit_log").first<{ a: string }>();
    for (const action of ["product_group.created", "product_group.updated", "unit.created", "unit.updated", "ledger_group.created", "ledger_group.updated"]) expect(a?.a).toContain(action);
    expect((await call(env, "/api/units", {})).status).toBe(401);
    expect((await call(env, "/api/product-groups", {})).status).toBe(401);
    // Every write route is behind login (same-origin request without a session).
    for (const [method, path] of [["POST", "/api/ledger-groups"], ["PUT", "/api/ledger-groups/1"], ["POST", "/api/units"], ["PUT", "/api/units/PCS"], ["POST", "/api/product-groups"], ["PUT", "/api/product-groups/1"]] as const) {
      expect((await call(env, path, { method, body: {} })).status).toBe(401);
    }
  });
});
