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

import { mkdtempSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PEERS = ["solid-js@1.9.12", "@opentui/solid@0.4.1"];
const PEER_DIRS = ["solid-js", "@opentui/solid"];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(REPO, "node_modules");

const already = PEER_DIRS.every((p) => existsSync(join(dest, ...p.split("/"))));
if (already && !process.argv.includes("--force")) {
  console.log("✓ peer runtime already present in node_modules (pass --force to reinstall)");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "tps-peers-"));
writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "tps-peers", private: true }) + "\n");

console.log(`• installing ${PEERS.join(" ")} in a clean project (${tmp}) …`);
try {
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--save-exact", ...PEERS], { cwd: tmp, stdio: "inherit" });

  copyMissingPackages(join(tmp, "node_modules"), dest);

  const ok = PEER_DIRS.every((p) => existsSync(join(dest, ...p.split("/"))));
  if (!ok) {
    console.error("✗ peer runtime did not land in node_modules");
    process.exit(1);
  }
  console.log(`✓ peer runtime copied into ${dest}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function copyMissingPackages(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.name.startsWith("@")) {
      mkdirSync(dst, { recursive: true });
      for (const scoped of readdirSync(src, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        copyPackage(join(src, scoped.name), join(dst, scoped.name));
      }
    } else {
      copyPackage(src, dst);
    }
  }
}

function copyPackage(src, dst) {
  if (existsSync(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, force: false, errorOnExist: true });
}
