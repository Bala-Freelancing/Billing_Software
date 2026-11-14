#!/usr/bin/env node
// Owner account management, run from a terminal by whoever controls the
// Cloudflare account. There is deliberately no web page for this: creating the
// first account or recovering a forgotten owner password requires access to
// the Cloudflare account itself, so a website visitor can never do it.
//
//   npm run owner:create -- --local  --username owner --name "Gayathri Owner"
//   npm run owner:create -- --remote --username owner --name "Gayathri Owner"
//   npm run owner:reset-password -- --remote --username owner
//
// The password is typed at a hidden prompt (never a command-line argument, so
// it does not end up in shell history or process listings).
//
// Hash format must match worker/lib/password.ts (checked by test/owner-script.test.ts).

import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { passwordProblems, USERNAME_PATTERN } = await import(pathToFileURL(path.join(ROOT, "shared/auth.ts")).href);

const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 100_000;

export function hashPasswordNode(password, iterations) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  return `pbkdf2-sha256$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Reads PASSWORD_HASH_ITERATIONS from wrangler.jsonc so script and Worker always agree. */
function configuredIterations() {
  const config = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  const match = config.match(/"PASSWORD_HASH_ITERATIONS"\s*:\s*"(\d+)"/);
  const iterations = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    fail(`PASSWORD_HASH_ITERATIONS in wrangler.jsonc must be between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}.`);
  }
  return iterations;
}

/** SQL string literal. Inputs are validated first; this is a second line of defence. */
function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWrangler(args, { capture = false } = {}) {
  const wranglerBin = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) fail(`Could not run wrangler: ${result.error.message}`);
  if (result.status !== 0) {
    if (capture) console.error(result.stderr || result.stdout);
    fail("The database command failed (see the output above).");
  }
  return result.stdout ?? "";
}

function query(target, sqlText) {
  const out = runWrangler(["d1", "execute", "DB", target, "--json", "--command", sqlText], { capture: true });
  const start = out.indexOf("[");
  if (start === -1) fail(`Unexpected output from wrangler:\n${out}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

function executeFile(target, sqlText) {
  const dir = mkdtempSync(path.join(tmpdir(), "gb-owner-"));
  const file = path.join(dir, "change.sql");
  try {
    writeFileSync(file, sqlText, { mode: 0o600 });
    runWrangler(["d1", "execute", "DB", target, "--yes", "--file", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// When input is piped (not a terminal), read it line by line from one shared reader.
let pipedLines = null;
async function nextPipedLine() {
  pipedLines ??= createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const { value, done } = await pipedLines.next();
  if (done) fail("Input ended before a password was entered.");
  return value;
}

/** Prompts without echoing what is typed. Falls back to plain line input when not a terminal. */
async function promptHidden(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    const line = await nextPipedLine();
    process.stdout.write("\n");
    return line;
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readNewPassword(username) {
  for (;;) {
    const first = await promptHidden("New password: ");
    const problems = passwordProblems(first, username);
    if (problems.length) {
      console.error(`  ✖ ${problems.join("\n  ✖ ")}`);
      continue;
    }
    const second = await promptHidden("Type it again: ");
    if (first !== second) {
      console.error("  ✖ The two entries don't match. Try again.");
      continue;
    }
    return first;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      username: { type: "string" },
      name: { type: "string" },
    },
  });

  const command = positionals[0];
  if (command !== "create" && command !== "reset-password") {
    fail("Usage: owner.mjs <create|reset-password> --local|--remote --username <name> [--name <display name>]");
  }
  if (values.local === values.remote) fail("Choose exactly one of --local or --remote.");
  const target = values.local ? "--local" : "--remote";

  const username = (values.username ?? "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    fail("--username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.");
  }

  const iterations = configuredIterations();
  const existing = query(target, `SELECT id FROM users WHERE username = ${sql(username)}`);
  const now = Date.now();

  if (command === "create") {
    const displayName = (values.name ?? "").trim();
    if (displayName.length < 1 || displayName.length > 80 || [...displayName].some((ch) => ch.charCodeAt(0) < 32)) {
      fail('--name is required (1–80 characters), e.g. --name "Gayathri Owner".');
    }
    if (existing.length) fail(`User "${username}" already exists. Use owner:reset-password instead.`);

    console.log(`Creating owner "${username}" on the ${values.local ? "LOCAL" : "REMOTE (production)"} database.`);
    const hash = hashPasswordNode(await readNewPassword(username), iterations);
    executeFile(
      target,
      `INSERT INTO users (username, display_name, password_hash, role, is_active, password_changed_at, created_at, updated_at)
       VALUES (${sql(username)}, ${sql(displayName)}, ${sql(hash)}, 'owner', 1, ${now}, ${now}, ${now});
       INSERT INTO audit_log (created_at, user_id, action, details)
       VALUES (${now}, (SELECT id FROM users WHERE username = ${sql(username)}), 'admin.owner_created', json_object('via', 'cli'));`,
    );
    console.log(`\n✔ Owner "${username}" created. You can now sign in.\n`);
    return;
  }

  if (!existing.length) fail(`No user named "${username}".`);
  console.log(`Resetting the password for "${username}" on the ${values.local ? "LOCAL" : "REMOTE (production)"} database.`);
  const hash = hashPasswordNode(await readNewPassword(username), iterations);
  const userId = Number(existing[0].id);
  executeFile(
    target,
    `UPDATE users SET password_hash = ${sql(hash)}, password_changed_at = ${now}, updated_at = ${now} WHERE id = ${userId};
     DELETE FROM sessions WHERE user_id = ${userId};
     INSERT INTO audit_log (created_at, user_id, action, details)
     VALUES (${now}, ${userId}, 'admin.password_reset', json_object('via', 'cli'));`,
  );
  console.log(`\n✔ Password reset for "${username}". All existing sign-ins were ended.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
