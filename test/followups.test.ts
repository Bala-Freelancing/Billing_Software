import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FollowUp } from "../shared/followups";
import { todayIst } from "../shared/gst";
import type { Overview } from "../shared/stats";
import { call, createTestContext, createUser, errorCode, login, type TestContext } from "./helpers";

let ctx: TestContext;
let env: Env;
let cookie: string;
const today = todayIst();
const get = (path: string) => call(env, path, { cookie });
const post = (path: string, body: unknown) => call(env, path, { method: "POST", body, cookie });
const put = (path: string, body: unknown) => call(env, path, { method: "PUT", body, cookie });
async function json<T>(res: Response): Promise<T> {
  if (res.status >= 400) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const enquiry = (o: Record<string, unknown> = {}) => ({ uid: crypto.randomUUID(), name: "Ravi Kumar", phone: "98421 12345", note: "Stealth fan ×4", dueDate: today, ...o });

beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.env;
  cookie = await login(env, await createUser(env));
});
afterAll(async () => {
  await ctx.dispose();
});

describe("follow-ups", () => {
  it("saves an enquiry once per form (idempotent) and lists open ones by due date", async () => {
    const body = enquiry({ dueDate: "2030-01-05" });
    const a = await json<FollowUp>(await post("/api/follow-ups", body));
    const again = await json<FollowUp>(await post("/api/follow-ups", body));
    expect(again.id).toBe(a.id);
    const earlier = await json<FollowUp>(await post("/api/follow-ups", enquiry({ dueDate: "2020-01-01", name: "Selvam" })));
    const open = (await json<{ items: FollowUp[] }>(await get("/api/follow-ups"))).items;
    expect(open.map((f) => f.id).indexOf(earlier.id)).toBeLessThan(open.map((f) => f.id).indexOf(a.id));
    expect(open.filter((f) => f.id === a.id)).toHaveLength(1);
  });

  it("closes, snoozes and edits with optimistic locking", async () => {
    const f = await json<FollowUp>(await post("/api/follow-ups", enquiry()));
    const won = await json<FollowUp>(await put(`/api/follow-ups/${f.id}`, { name: f.name, phone: f.phone, note: f.note, dueDate: f.dueDate, status: "won", updatedAt: f.updatedAt }));
    expect(won.status).toBe("won");
    expect(await errorCode(await put(`/api/follow-ups/${f.id}`, { name: f.name, phone: f.phone, note: f.note, dueDate: "2031-01-01", status: "open", updatedAt: f.updatedAt }))).toBe("CONFLICT");
    expect((await json<{ items: FollowUp[] }>(await get("/api/follow-ups"))).items.some((x) => x.id === f.id)).toBe(false);
    expect((await json<{ items: FollowUp[] }>(await get("/api/follow-ups?status=won"))).items.some((x) => x.id === f.id)).toBe(true);
    expect((await put("/api/follow-ups/999999", { name: "x", phone: "", note: "", dueDate: today, status: "open", updatedAt: 0 })).status).toBe(404);
  });

  it("validates input, needs login, and counts due ones on the dashboard", async () => {
    for (const bad of [{ name: " " }, { phone: "call me" }, { dueDate: "tomorrow" }, { uid: "x" }]) {
      expect((await post("/api/follow-ups", enquiry(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(env, "/api/follow-ups")).status).toBe(401);
    const o = await json<Overview>(await get("/api/stats/overview"));
    // Open and due today or earlier: the 2020 enquiry from the first test at least.
    expect(o.followUpsDue).toBeGreaterThanOrEqual(1);
  });
});
