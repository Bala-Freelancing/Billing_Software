# Sri Vishnu Communication Billing — working rules

Billing software for Sri Vishnu Communication (retail shop, Tamil Nadu). It replaces an
existing billing system and **goes to production**: real invoices, real GST filings,
real money. Treat every change accordingly.

## Rules for every change

1. **Production-grade only.** Strict TypeScript, validated inputs on the server (zod,
   shared with the client from `shared/`), consistent error responses, migrations for
   every schema change, and automated tests for every module.
2. **Think before writing code.** Before each module, list what can fail in production
   (concurrency, partial writes, bad input, limits, time zones, rounding, security) and
   design against it. Record the reasoning in the PR description.
3. **Clear doubts first.** If a requirement is ambiguous, ask before building.
4. **Small modules.** One module per branch and pull request. Never push to `main`
   directly; the owner reviews and merges.

## Stack

- React + Vite + Tailwind (`src/`), served as static assets by the same Worker.
- Cloudflare Worker + Hono API (`worker/`), all routes under `/api/*`.
- Cloudflare D1 (SQLite) with hand-written SQL migrations (`migrations/`) and raw
  prepared statements. No ORM.
- `shared/` holds validation schemas and API types used by both sides.
- Target: **Workers Free plan** — 10 ms CPU per request, 100k D1 writes/day,
  500 MB per database. Design within these limits.

## Data rules (non-negotiable)

- **Money is stored as integer paise** (₹199.50 → 19950). Never floats.
- **Timestamps are integer milliseconds UTC.** Convert to IST only for display.
- **Bills and payments are never hard-deleted.** Cancel with a reason; keep history.
- **Multi-row changes go in one `db.batch([...])`** (a single transaction) so a
  bill, its items, stock and the audit entry are saved together or not at all.
- **Every security- or money-relevant change writes an `audit_log` row** in the
  same batch. `audit_log` is append-only (enforced by triggers).
- Store the GST rate on each bill line at billing time, never only on the product.
- **Migrations must be backward-compatible.** The Deploy workflow applies them
  *before* the new code goes live, so the previous release must keep working on the
  new schema: add tables/columns (with defaults); rename or drop only in a later
  release once nothing uses the old shape. Never edit a migration that has merged.
- Tables use `STRICT`; add indexes for every column used in report filters.

## Security

- Session cookie `__Host-billing_session`: HttpOnly, Secure, SameSite=Strict. The DB stores
  only the token's SHA-256.
- State-changing requests must pass the same-origin check (`sameOriginOnly`).
- Never log passwords, tokens or full request bodies. Never commit secrets.
- Passwords: PBKDF2-SHA256, iterations from `PASSWORD_HASH_ITERATIONS` (30000 on
  the free plan). `scripts/owner.mjs` must stay format-compatible with
  `worker/lib/password.ts`.

## Commands

- `npm run dev` — local app + API with a local D1 (no Cloudflare account needed)
- `npm run db:migrate:local` — apply migrations to the local database
- `npm run owner:create -- --local` — create the owner account locally
- `npm run check` — typecheck, lint, tests and build; must pass before every PR
