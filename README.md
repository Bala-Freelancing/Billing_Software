# Sri Vishnu Communication — Billing

Billing software for Sri Vishnu Communication: purchases, GST sales invoices, credit
tracking, GST-slab reports for the auditor, and sales statistics.

Runs entirely on Cloudflare (Workers + D1) and is designed to stay on the **free plan**.

| Part      | Technology                                                    |
| --------- | ------------------------------------------------------------- |
| Website   | React 19, Vite, Tailwind CSS (`src/`)                         |
| API       | Cloudflare Worker with Hono (`worker/`), all under `/api/*`   |
| Database  | Cloudflare D1 (SQLite), SQL migrations in `migrations/`       |
| Shared    | Validation rules and API types used by both sides (`shared/`) |

Project rules for contributors (and for Claude) are in [`CLAUDE.md`](CLAUDE.md).

## Status

- [x] **Module 1 — Sign-in**: owner login, sessions, change password, sign out of all devices
- [ ] Module 2 — Shop settings, GST slabs, products, customers and suppliers
- [ ] Module 3 — Purchase entry and stock
- [ ] Module 4 — Sales billing and printable invoice
- [ ] Module 5 — Credit: receipts, payments, outstanding, days pending
- [ ] Module 6 — Reports: purchase/sales registers, GST-slab PDF
- [ ] Module 7 — Dashboard
- [ ] Module 8 — Data import and go-live

## Run it on your computer

No Cloudflare account is needed for local development — the database runs locally.

**Requirements:** Node.js 22.12 or newer, Git.

```bash
npm ci                                   # install exact locked versions
npm run db:migrate:local                 # create the local database tables
npm run owner:create -- --local --username owner --name "Shop Owner"
npm run dev                              # open http://localhost:5173
```

`owner:create` asks for the password at a hidden prompt (12+ characters; a short
phrase such as `blue phone shop since 1998` is easiest to remember).

Use Chrome or Edge locally. Safari refuses the secure session cookie on
`http://localhost`, so sign-in only works there once deployed on HTTPS.

> Adding or upgrading packages: use `npx npm@11 install <pkg>`. npm 10 has a bug
> resolving this dependency tree from scratch. Plain `npm ci` works on both.

### Useful commands

| Command                                   | What it does                                     |
| ----------------------------------------- | ------------------------------------------------ |
| `npm run dev`                             | App + API with hot reload and a local database   |
| `npm run check`                           | Type-check, lint, tests and build (run before PRs) |
| `npm test`                                | Automated tests only                             |
| `npm run owner:reset-password -- --local --username owner` | Set a new owner password locally |

## First deployment

1. Create a free Cloudflare account, then sign in from the terminal:
   ```bash
   npx wrangler login
   ```
2. Create the production database and copy the `database_id` it prints into
   `wrangler.jsonc` (replace the `00000000-…` placeholder):
   ```bash
   npx wrangler d1 create sri-vishnu-billing-db
   ```
3. Deploy (runs all checks, applies migrations to the production database, then deploys):
   ```bash
   npm run deploy
   ```
4. Create the owner account on the production database:
   ```bash
   npm run owner:create -- --remote --username owner --name "Shop Owner"
   ```
5. Open the `*.workers.dev` address that the deploy printed and sign in.

### Recommended Cloudflare settings (free)

- **Rate limiting rule** (Security → WAF → Rate limiting rules): limit
  `/api/auth/login` to about 20 requests per minute per IP. The app already
  throttles failed logins; this stops floods before they reach the Worker.
- **Custom domain** (optional): Workers → your worker → Settings → Domains & Routes.

## Forgotten owner password

There is intentionally no "forgot password" link — the reset needs access to the
Cloudflare account, so no website visitor can trigger it.

```bash
npm run owner:reset-password -- --remote --username owner
```

This sets a new password and signs out every device.

## Backups

D1 keeps point-in-time history automatically (7 days on the free plan). To restore,
see `npx wrangler d1 time-travel --help`. A scheduled off-site export will be added
before go-live (Module 8).

## Security design (Module 1)

- Passwords: PBKDF2-SHA256 with a per-user salt. The work factor
  (`PASSWORD_HASH_ITERATIONS`, default 30 000) is sized for the free plan's 10 ms CPU
  limit. On Workers Paid, raise it to 100 000; hashes upgrade on next sign-in.
- Sessions: random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  `__Host-` cookie. The database stores only the token's SHA-256. Sessions end after
  30 days without use, on sign-out, on "sign out of all devices", or on password change.
- Brute force: 10 failed attempts per IP within 15 minutes blocks that IP for the rest
  of the window. Not per username, so nobody can lock the owner out remotely.
- CSRF: `SameSite=Strict` cookie plus a same-origin check on every state-changing request.
- Every sign-in, failure, sign-out and password change is recorded in an append-only
  `audit_log` table.
- Security headers (CSP, HSTS, frame blocking) on every page and API response.
- A daily scheduled job removes expired sessions and stale login-failure records.
