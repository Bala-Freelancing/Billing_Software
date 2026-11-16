#!/usr/bin/env node
// CI helper: makes sure the production D1 database exists and that
// wrangler.jsonc points at it, so a deploy never runs against the placeholder.
//
// - If wrangler.jsonc already has a real database_id, it is checked to exist.
// - If it still has the placeholder, the database is looked up by name and
//   created (in the Asia-Pacific region, close to the shop) if missing; the id
//   is written into wrangler.jsonc for this CI run only and printed in the job
//   summary so it can be committed.
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "wrangler.jsonc");
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function wrangler(args) {
  const bin = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    fail(`wrangler ${args.slice(0, 2).join(" ")} failed. Check the API token has "D1: Edit" permission.`);
  }
  return result.stdout;
}

function listDatabases() {
  const out = wrangler(["d1", "list", "--json"]);
  const start = out.indexOf("[");
  if (start === -1) fail(`Unexpected output from "wrangler d1 list":\n${out}`);
  return JSON.parse(out.slice(start));
}

const config = readFileSync(CONFIG, "utf8");
const name = config.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];
const configuredId = config.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
if (!name || !configuredId) fail("wrangler.jsonc must define database_name and database_id.");

if (configuredId !== PLACEHOLDER) {
  if (!UUID.test(configuredId)) fail(`database_id in wrangler.jsonc is not a valid id: ${configuredId}`);
  const found = listDatabases().find((db) => db.uuid === configuredId);
  if (!found) fail(`database_id ${configuredId} from wrangler.jsonc does not exist in this Cloudflare account.`);
  console.log(`Using D1 database "${found.name}" (${configuredId}).`);
  process.exit(0);
}

let id = listDatabases().find((db) => db.name === name)?.uuid;
if (id) {
  console.log(`Found existing D1 database "${name}" (${id}).`);
} else {
  console.log(`Creating D1 database "${name}" in Asia-Pacific…`);
  const out = wrangler(["d1", "create", name, "--location", "apac"]);
  id = out.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)?.[1] ?? out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1];
  if (!id) id = listDatabases().find((db) => db.name === name)?.uuid;
  if (!id) fail(`Created "${name}" but could not read its id.`);
  console.log(`Created D1 database "${name}" (${id}).`);
}

writeFileSync(CONFIG, config.replace(PLACEHOLDER, id));
summary(
  [
    "### Production database",
    "",
    `\`wrangler.jsonc\` still has the placeholder id. This run used **\`${id}\`** (\`${name}\`).`,
    "Commit this id into `wrangler.jsonc` so terminal commands such as `owner:create -- --remote` reach the same database.",
  ].join("\n"),
);
