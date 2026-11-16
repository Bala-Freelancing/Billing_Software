import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gstinProblem } from "../shared/india";
import type { GstSlab, ListResponse, Party, Product, ScanResult, ShopSettings } from "../shared/masters";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;

/** Builds a GSTIN with a correct check digit from its first 14 characters. */
function gstin(first14: string): string {
  for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (gstinProblem(first14 + ch) === null) return first14 + ch;
  }
  throw new Error("no check digit");
}
const TN_GSTIN = gstin("33ABCDE1234F1Z");
const KA_GSTIN = gstin("29ABCDE1234F1Z");

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
  for (const name of ["Fans", "Switches"]) {
    await call(env, "/api/product-groups", { method: "POST", cookie, body: { name, isActive: true } });
  }
});
afterAll(async () => {
  await ctx.dispose();
});

const get = (path: string) => call(env, path, { cookie });
const send = (method: string, path: string, body: unknown) => call(env, path, { method, body, cookie });

async function slabId(rateBp: number): Promise<number> {
  const { items } = (await (await get("/api/gst-slabs")).json()) as { items: GstSlab[] };
  const slab = items.find((s) => s.rateBp === rateBp);
  if (!slab) throw new Error(`no slab ${rateBp}`);
  return slab.id;
}

let productCounter = 0;
async function productInput(overrides: Record<string, unknown> = {}) {
  productCounter += 1;
  return {
    brand: "Havells",
    name: `Test Fan ${productCounter}`,
    category: "Fans",
    hsnCode: "8414",
    gstSlabId: await slabId(1800),
    unit: "PCS",
    mrpPaise: 450000,
    sellingPricePaise: 399900,
    barcode: "",
    tracksSerial: true,
    isActive: true,
    ...overrides,
  };
}

function partyInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sri Murugan Electricals",
    partyType: "customer",
    phone: "9876543210",
    email: "",
    gstin: "",
    address: "12 Main Road",
    city: "Tiruchirappalli",
    stateCode: "33",
    pincode: "621005",
    openingBalancePaise: 0,
    isActive: true,
    ...overrides,
  };
}

describe("access", () => {
  it("requires sign-in for every master-data route but leaves login reachable", async () => {
    for (const path of ["/api/settings/shop", "/api/gst-slabs", "/api/products", "/api/parties", "/api/scan/ABC"]) {
      expect((await call(env, path)).status).toBe(401);
    }
    expect((await call(env, "/api/health")).status).toBe(200);
    const user = await createUser(env);
    await login(env, user);
  });
});

describe("GSTIN validation", () => {
  it("accepts a correct GSTIN and rejects bad shape, state or check digit", () => {
    expect(gstinProblem(TN_GSTIN)).toBeNull();
    expect(gstinProblem("33ABCDE1234F1Z")).not.toBeNull();
    expect(gstinProblem(`99${TN_GSTIN.slice(2)}`)).not.toBeNull();
    const wrongCheck = TN_GSTIN.slice(0, 14) + (TN_GSTIN[14] === "A" ? "B" : "A");
    expect(gstinProblem(wrongCheck)).toMatch(/check digit/);
  });
});

describe("shop settings", () => {
  it("starts with the shop name and saves changes with optimistic locking", async () => {
    const current = (await (await get("/api/settings/shop")).json()) as ShopSettings;
    expect(current.shopName).toBe("Sri Vishnu Communication");
    expect(current.stateCode).toBe("33");

    const res = await send("PUT", "/api/settings/shop", { ...current, gstin: TN_GSTIN.toLowerCase(), bankIfsc: "sbin0001234", city: "Tiruchirappalli" });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as ShopSettings;
    expect(saved.gstin).toBe(TN_GSTIN);
    expect(saved.bankIfsc).toBe("SBIN0001234");
    expect(saved.updatedAt).toBeGreaterThan(current.updatedAt);

    // Saving again with the stale version is refused.
    const stale = await send("PUT", "/api/settings/shop", { ...current, city: "Chennai" });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe("CONFLICT");
  });

  it("rejects a GSTIN from another state than the one selected", async () => {
    const current = (await (await get("/api/settings/shop")).json()) as ShopSettings;
    const res = await send("PUT", "/api/settings/shop", { ...current, gstin: KA_GSTIN, stateCode: "33" });
    expect(res.status).toBe(400);
  });
});

describe("GST slabs", () => {
  it("lists the standard rates, adds a new one, refuses duplicates, and can retire a rate", async () => {
    const { items } = (await (await get("/api/gst-slabs")).json()) as { items: GstSlab[] };
    expect(items.map((s) => s.rateBp)).toEqual([0, 500, 1200, 1800, 2800]);

    const created = await send("POST", "/api/gst-slabs", { ratePercent: 3 });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as GstSlab;
    expect((await send("POST", "/api/gst-slabs", { ratePercent: 3 })).status).toBe(409);

    expect((await send("PATCH", `/api/gst-slabs/${id}`, { isActive: false })).status).toBe(204);
    const after = (await (await get("/api/gst-slabs")).json()) as { items: GstSlab[] };
    expect(after.items.find((s) => s.id === id)?.isActive).toBe(false);
  });

  it("never lets a stored rate change", async () => {
    await expect(env.DB.prepare("UPDATE gst_slabs SET rate_bp = 1900 WHERE rate_bp = 1800").run()).rejects.toThrow(/cannot be changed/);
  });
});

describe("products", () => {
  it("creates a product and returns its GST rate and stock", async () => {
    const input = await productInput({ barcode: " 8901 234 " });
    const res = await send("POST", "/api/products", input);
    expect(res.status).toBe(201);
    const p = (await res.json()) as Product;
    expect(p).toMatchObject({ brand: "Havells", gstRateBp: 1800, inStock: 0, tracksSerial: true, barcode: "8901234" });
  });

  it("validates prices, HSN code and unit", async () => {
    for (const bad of [
      { sellingPricePaise: 500000, mrpPaise: 450000 },
      { hsnCode: "84A4" },
      { hsnCode: "841" },
      { unit: "KG" },
      { mrpPaise: 12.5 },
      { mrpPaise: -1 },
    ]) {
      const res = await send("POST", "/api/products", await productInput(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("refuses duplicate barcodes and duplicate brand + name (case-insensitive)", async () => {
    const first = await productInput({ barcode: "DUP-111" });
    expect((await send("POST", "/api/products", first)).status).toBe(201);
    const sameBarcode = await send("POST", "/api/products", await productInput({ barcode: "dup-111" }));
    expect(sameBarcode.status).toBe(409);
    const sameName = await send("POST", "/api/products", { ...(await productInput()), name: first.name.toUpperCase() });
    expect(sameName.status).toBe(409);
  });

  it("updates with optimistic locking and records the change in the audit log", async () => {
    const created = (await (await send("POST", "/api/products", await productInput())).json()) as Product;
    const updated = await send("PUT", `/api/products/${created.id}`, {
      ...(await productInput({ name: created.name })),
      sellingPricePaise: 380000,
      updatedAt: created.updatedAt,
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as Product).sellingPricePaise).toBe(380000);

    const stale = await send("PUT", `/api/products/${created.id}`, {
      ...(await productInput({ name: created.name })),
      updatedAt: created.updatedAt,
    });
    expect(stale.status).toBe(409);

    const audit = await env.DB.prepare("SELECT details FROM audit_log WHERE action = 'product.updated' AND json_extract(details, '$.id') = ?1")
      .bind(created.id)
      .all<{ details: string }>();
    expect(audit.results).toHaveLength(1);
    expect(JSON.parse(audit.results[0]?.details ?? "{}").changes.sellingPricePaise).toEqual([399900, 380000]);
  });

  it("does not allow a retired GST rate on new products, but keeps it on existing ones", async () => {
    const res = await send("POST", "/api/gst-slabs", { ratePercent: 7 });
    const { id: slab } = (await res.json()) as GstSlab;
    const product = (await (await send("POST", "/api/products", await productInput({ gstSlabId: slab }))).json()) as Product;
    await send("PATCH", `/api/gst-slabs/${slab}`, { isActive: false });

    expect((await send("POST", "/api/products", await productInput({ gstSlabId: slab }))).status).toBe(400);
    const keep = await send("PUT", `/api/products/${product.id}`, {
      ...(await productInput({ name: product.name, gstSlabId: slab })),
      updatedAt: product.updatedAt,
    });
    expect(keep.status).toBe(200);
  });

  it("searches by name, brand, HSN and exact barcode, and filters inactive products", async () => {
    const special = await productInput({ name: "Crabtree Athena 6A Switch", category: "Switches", hsnCode: "85365090", barcode: "SW-ATHENA-6A" });
    const created = (await (await send("POST", "/api/products", special)).json()) as Product;
    const search = async (q: string, status = "active") =>
      ((await (await get(`/api/products?q=${encodeURIComponent(q)}&status=${status}`)).json()) as ListResponse<Product>).items.map((p) => p.id);

    expect(await search("athena")).toContain(created.id);
    expect(await search("85365090")).toContain(created.id);
    expect(await search("sw-athena-6a")).toContain(created.id);
    expect(await search("%")).not.toContain(created.id); // LIKE wildcards are matched literally

    await send("PUT", `/api/products/${created.id}`, { ...special, isActive: false, updatedAt: created.updatedAt });
    expect(await search("athena")).not.toContain(created.id);
    expect(await search("athena", "inactive")).toContain(created.id);
  });

  it("keeps serial tracking on while serial-numbered units are in stock", async () => {
    const created = (await (await send("POST", "/api/products", await productInput())).json()) as Product;
    await env.DB.prepare("INSERT INTO product_units (product_id, serial, status, created_at, updated_at) VALUES (?1, ?2, 'in_stock', 1, 1)")
      .bind(created.id, `SN-LOCK-${created.id}`)
      .run();
    const res = await send("PUT", `/api/products/${created.id}`, {
      ...(await productInput({ name: created.name })),
      tracksSerial: false,
      updatedAt: created.updatedAt,
    });
    expect(res.status).toBe(400);
  });
});

describe("scan lookup", () => {
  it("finds a unit by serial number, a product by barcode, or nothing", async () => {
    const product = (await (await send("POST", "/api/products", await productInput({ barcode: "8906012345678" }))).json()) as Product;
    await env.DB.prepare("INSERT INTO product_units (product_id, serial, status, created_at, updated_at) VALUES (?1, 'HVFAN0001', 'in_stock', 1, 1)")
      .bind(product.id)
      .run();

    const unit = (await (await get("/api/scan/hvfan%200001")).json()) as ScanResult;
    expect(unit).toMatchObject({ kind: "unit", serial: "HVFAN0001", status: "in_stock", product: { id: product.id, inStock: 1 } });

    const byBarcode = (await (await get("/api/scan/8906012345678")).json()) as ScanResult;
    expect(byBarcode).toMatchObject({ kind: "product", product: { id: product.id } });

    expect(await (await get("/api/scan/NOPE-404")).json()).toEqual({ kind: "none", code: "NOPE-404" });
  });

  it("never stores the same serial twice", async () => {
    const product = (await (await send("POST", "/api/products", await productInput())).json()) as Product;
    const insert = (serial: string) =>
      env.DB.prepare("INSERT INTO product_units (product_id, serial, status, created_at, updated_at) VALUES (?1, ?2, 'in_stock', 1, 1)")
        .bind(product.id, serial)
        .run();
    await insert("UNIQUE-SN-1");
    await expect(insert("UNIQUE-SN-1")).rejects.toThrow(/UNIQUE/);
  });
});

describe("parties", () => {
  it("creates a retailer with a GSTIN and refuses a second party with the same GSTIN", async () => {
    const res = await send("POST", "/api/parties", partyInput({ gstin: TN_GSTIN.toLowerCase() }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as Party).gstin).toBe(TN_GSTIN);
    const dup = await send("POST", "/api/parties", partyInput({ name: "Another", gstin: TN_GSTIN }));
    expect(dup.status).toBe(409);
  });

  it("requires the state to match the GSTIN and validates contact details", async () => {
    expect((await send("POST", "/api/parties", partyInput({ gstin: KA_GSTIN, stateCode: "33" }))).status).toBe(400);
    expect((await send("POST", "/api/parties", partyInput({ gstin: KA_GSTIN, stateCode: "29" }))).status).toBe(201);
    for (const bad of [{ pincode: "12345" }, { phone: "call me" }, { email: "nope" }, { stateCode: "99" }, { name: "  " }]) {
      expect((await send("POST", "/api/parties", partyInput(bad))).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("stores signed opening balances and filters by type (\"both\" appears in each list)", async () => {
    const supplier = (await (await send("POST", "/api/parties", partyInput({ name: "Havells India Ltd", partyType: "supplier", openingBalancePaise: -2500000 }))).json()) as Party;
    const both = (await (await send("POST", "/api/parties", partyInput({ name: "Both Ways Traders", partyType: "both" }))).json()) as Party;
    expect(supplier.openingBalancePaise).toBe(-2500000);

    const ids = async (type: string) =>
      ((await (await get(`/api/parties?type=${type}`)).json()) as ListResponse<Party>).items.map((p) => p.id);
    expect(await ids("supplier")).toEqual(expect.arrayContaining([supplier.id, both.id]));
    expect(await ids("customer")).toContain(both.id);
    expect(await ids("customer")).not.toContain(supplier.id);
  });

  it("updates with optimistic locking", async () => {
    const party = (await (await send("POST", "/api/parties", partyInput({ name: "Lock Test Stores" }))).json()) as Party;
    const ok = await send("PUT", `/api/parties/${party.id}`, { ...partyInput({ name: "Lock Test Stores", city: "Madurai" }), updatedAt: party.updatedAt });
    expect(ok.status).toBe(200);
    const stale = await send("PUT", `/api/parties/${party.id}`, { ...partyInput({ name: "Lock Test Stores" }), updatedAt: party.updatedAt });
    expect(stale.status).toBe(409);
    expect((await get("/api/parties/999999")).status).toBe(404);
    expect((await get("/api/parties/abc")).status).toBe(404);
  });
});

describe("dashboard", () => {
  it("includes party opening balances in payables", async () => {
    const res = await get("/api/stats/overview");
    expect(res.status).toBe(200);
    const d = (await res.json()) as Record<string, number>;
    expect(d.payablePaise).toBeGreaterThanOrEqual(2500000); // Havells supplier opening balance above
    expect((await call(env, "/api/stats/overview")).status).toBe(401);
  });
});
