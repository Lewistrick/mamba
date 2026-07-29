/**
 * Optional local `.env` loader for the multiplayer server.
 *
 * Vite loads env automatically; Node does not. Docker Compose injects env
 * directly, so a missing `.env` file is fine.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Reads KEY=VALUE lines into process.env when the key is unset.
 *
 * @param file - Absolute or cwd-relative path (default: `.env` in cwd).
 */
export function loadDotEnv(file = resolve(process.cwd(), ".env")): void {
  if (!existsSync(file)) {
    return;
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
