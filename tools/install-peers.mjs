#!/usr/bin/env node
/**
 * install-peers.mjs — make the optional peer runtime (`solid-js` + `@opentui/solid`)
 * resolvable from this repo's node_modules, so `bun tools/verify-plugin.mjs` can
 * load the real TSX locally and in CI.
 *
 * Why this exists: those packages are declared as **optional** peerDependencies,
 * and npm refuses to install an optional peer even when asked directly (and even
 * if it's also a devDependency). So we install them in a clean throwaway project
 * that has no peer constraint, then copy the result into ./node_modules.
 *
 * Dev/CI only — never shipped (the package `files` allowlist excludes tools/).
 */

import { mkdtempSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PEERS = ["solid-js", "@opentui/solid"];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(REPO, "node_modules");

const already = PEERS.every((p) => existsSync(join(dest, ...p.split("/"))));
if (already && !process.argv.includes("--force")) {
  console.log("✓ peer runtime already present in node_modules (pass --force to reinstall)");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "tps-peers-"));
writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "tps-peers", private: true }) + "\n");

console.log(`• installing ${PEERS.join(" ")} in a clean project (${tmp}) …`);
execFileSync("npm", ["install", "--no-audit", "--no-fund", ...PEERS], { cwd: tmp, stdio: "inherit" });

mkdirSync(dest, { recursive: true });
cpSync(join(tmp, "node_modules"), dest, { recursive: true });

const ok = PEERS.every((p) => existsSync(join(dest, ...p.split("/"))));
if (!ok) {
  console.error("✗ peer runtime did not land in node_modules");
  process.exit(1);
}
console.log(`✓ peer runtime copied into ${dest}`);
