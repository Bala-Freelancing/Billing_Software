// Applies the real migrations (exactly as production does) to a throw-away
// local D1 database once per test run. Test files copy this template.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default function setup() {
  const templateDir = mkdtempSync(path.join(tmpdir(), "billing-test-db-"));
  const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
  execFileSync(
    process.execPath,
    [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", templateDir],
    { stdio: "pipe", env: { ...process.env, CI: "1" } },
  );
  process.env.TEST_DB_TEMPLATE = templateDir;
  return () => rmSync(templateDir, { recursive: true, force: true });
}
