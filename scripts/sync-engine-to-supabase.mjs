/**
 * Copies the deterministic engine into the Edge Function shared folder
 * so verify-score can re-simulate replays without publishing a package.
 */

import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages", "engine", "src");
const dest = join(root, "supabase", "functions", "_shared", "engine");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const name of readdirSync(src)) {
  if (name.endsWith(".test.ts")) {
    continue;
  }
  cpSync(join(src, name), join(dest, name));
}

console.log(`Synced engine → ${dest}`);
