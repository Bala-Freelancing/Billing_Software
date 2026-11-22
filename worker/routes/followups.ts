// Module 10: follow-ups. Customers who enquired and said they'll come back;
// the shop reminds them from its own WhatsApp (one tap, no paid API).
import { Hono } from "hono";
import { followUpListQuery, followUpSchema, updateFollowUpSchema, type FollowUp, type FollowUpStatus } from "../../shared/followups";
import { conflict, notFound } from "../lib/db";
import { idParam, nextStamp } from "../lib/route";
import { requireAuth, validate } from "../middleware";
import type { AppEnv } from "../types";

interface Row {
  id: number;
  name: string;
  phone: string;
  note: string;
  due_date: string;
  status: FollowUpStatus;
  created_at: number;
  updated_at: number;
}
const toFollowUp = (r: Row): FollowUp => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  note: r.note,
  dueDate: r.due_date,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// shortcut: one unpaged list (open ones by due date, closed ones newest first), capped at 500; page it if a shop ever has more.
const LIST_LIMIT = 500;

export const followUpRoutes = new Hono<AppEnv>();
for (const path of ["/follow-ups", "/follow-ups/*"]) followUpRoutes.use(path, requireAuth);

followUpRoutes
  .get("/follow-ups", validate("query", followUpListQuery), async (c) => {
    const { status } = c.req.valid("query");
    const where = status === "all" ? "" : "WHERE status = ?1";
    const order = status === "open" ? "due_date, id" : "updated_at DESC";
    const stmt = c.env.DB.prepare(`SELECT * FROM follow_ups ${where} ORDER BY ${order} LIMIT ${LIST_LIMIT}`);
    const { results } = await (status === "all" ? stmt : stmt.bind(status)).all<Row>();
    return c.json({ items: results.map(toFollowUp) });
  })
  .post("/follow-ups", validate("json", followUpSchema), async (c) => {
    const f = c.req.valid("json");
    const db = c.env.DB;
    const now = Date.now();
    // Saving the same form twice returns the first result.
    await db
      .prepare(
        `INSERT INTO follow_ups (uid, name, phone, note, due_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (uid) DO NOTHING`,
      )
      .bind(f.uid, f.name, f.phone, f.note, f.dueDate, now)
      .run();
    const row = await db.prepare("SELECT * FROM follow_ups WHERE uid = ?1").bind(f.uid).first<Row>();
    return c.json(toFollowUp(row as Row), 201);
  })
  .put("/follow-ups/:id", validate("json", updateFollowUpSchema), async (c) => {
    const id = idParam(c);
    const f = c.req.valid("json");
    const db = c.env.DB;
    const current = await db.prepare("SELECT * FROM follow_ups WHERE id = ?1").bind(id).first<Row>();
    if (!current) throw notFound("Follow-up");
    const res = await db
      .prepare(
        `UPDATE follow_ups SET name = ?1, phone = ?2, note = ?3, due_date = ?4, status = ?5, updated_at = ?6
          WHERE id = ?7 AND updated_at = ?8`,
      )
      .bind(f.name, f.phone, f.note, f.dueDate, f.status, nextStamp(f.updatedAt), id, f.updatedAt)
      .run();
    if (!res.meta.changes) throw conflict();
    return c.json(toFollowUp((await db.prepare("SELECT * FROM follow_ups WHERE id = ?1").bind(id).first<Row>()) as Row));
  });
