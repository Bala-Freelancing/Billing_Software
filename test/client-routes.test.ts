// Guards against the front end calling an API path that doesn't exist (the GST
// PDF button once asked for /api/settings instead of /api/settings/shop).
// Every literal path passed to api(...) or useFetch(...) in src/ must match a
// worker route for at least one HTTP method.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createTestContext, createUser, login, type TestContext } from "./helpers";

let ctx: TestContext;
let cookie: string;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Static parts of every api()/useFetch() path; template parts become "1". */
function clientPaths(): string[] {
  const out = new Set<string>();
  const re = /(?:api|useFetch)(?:<[^>(]*>)?\(\s*(["`])(\/[^"`]*)\1/g;
  for (const f of files(path.resolve(__dirname, "../src"))) {
    for (const m of readFileSync(f, "utf8").matchAll(re)) {
      const p = m[2]!.replace(/\$\{[^}]+\}/g, "1").split("?")[0]!;
      out.add(p);
    }
  }
  return [...out].sort();
}

beforeAll(async () => {
  ctx = await createTestContext();
  cookie = await login(ctx.env, await createUser(ctx.env));
});
afterAll(async () => {
  await ctx.dispose();
});

describe("client API paths", () => {
  it("finds the paths used by the pages", () => {
    expect(clientPaths()).toEqual(expect.arrayContaining(["/settings/shop", "/stats/overview", "/reports/gst"]));
  });

  it("every path matches a worker route", async () => {
    const missing: string[] = [];
    // Auth routes are covered by test/auth.test.ts; calling them here would log this session out.
    for (const p of clientPaths().filter((x) => !x.startsWith("/auth/"))) {
      let found = false;
      for (const method of ["GET", "POST", "PUT", "PATCH"]) {
        const res = await call(ctx.env, `/api${p}`, { method, cookie, ...(method === "GET" ? {} : { body: {} }) });
        const text = await res.text();
        if (!(res.status === 404 && text.includes("No API route"))) {
          found = true;
          break;
        }
      }
      if (!found) missing.push(p);
    }
    expect(missing).toEqual([]);
  });
});

describe("side menu", () => {
  it("every menu link is a page route", async () => {
    const { NAV } = await import("../src/lib/nav");
    const main = readFileSync(path.resolve(__dirname, "../src/main.tsx"), "utf8");
    const routes = new Set([...main.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]));
    const missing = NAV.flatMap((g) => g.items.map((i) => i.to)).filter((to) => !routes.has(to));
    expect(missing).toEqual([]);
  });
});
