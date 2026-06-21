#!/usr/bin/env node
/**
 * install.mjs — wire opencode-tps-meter into an OpenCode config so the TUI loads
 * it on next launch.
 *
 * OpenCode loads TUI plugins by package name from `<config>/tui.json`
 * (`{ "plugin": [...] }`) and resolves them from `<config>/node_modules` (declared
 * in `<config>/package.json`). This script updates both, idempotently, and can
 * install from npm (default) or from this local checkout (`--local`, great for
 * development since the plugin isn't published yet).
 *
 * Usage:
 *   node scripts/install.mjs              # add to ~/.config/opencode (npm spec)
 *   node scripts/install.mjs --local      # link THIS checkout (file: dependency)
 *   node scripts/install.mjs --dir <path> # target a specific config dir
 *   node scripts/install.mjs --no-install # edit config only, skip `npm install`
 *   node scripts/install.mjs --dry-run    # print what would change, write nothing
 *   node scripts/install.mjs --uninstall  # remove the plugin from tui.json
 *   node scripts/install.mjs --print      # print manual instructions and exit
 *
 * Dependency-free (node built-ins only).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// The npm package name. Published under the @devinoldenburg scope because the
// unscoped name `opencode-tps-meter` is already owned on npm by a different
// author. OpenCode resolves the TUI plugin by THIS name from node_modules.
const PKG_NAME = "@devinoldenburg/opencode-tps-meter";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `install.mjs — wire opencode-tps-meter into an OpenCode config so the TUI loads it on next launch.

Usage:
  node scripts/install.mjs              # add to ~/.config/opencode (npm spec)
  node scripts/install.mjs --local      # link THIS checkout (file: dependency)
  node scripts/install.mjs --dir <path> # target a specific config dir
  node scripts/install.mjs --no-install # edit config only, skip npm install
  node scripts/install.mjs --dry-run    # print what would change, write nothing
  node scripts/install.mjs --uninstall  # remove plugin and dependency
  node scripts/install.mjs --print      # print manual instructions and exit`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--local") a.local = true;
    else if (t === "--no-install") a.noInstall = true;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--uninstall" || t === "--remove") a.uninstall = true;
    else if (t === "--print") a.print = true;
    else if (t === "--dir") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("--dir requires a path argument");
      a.dir = argv[++i];
    }
    else if (t === "--help" || t === "-h") a.help = true;
    else a._.push(t);
  }
  return a;
}

const C = {
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  green: (s) => `\x1b[92m${s}\x1b[0m`,
  cyan: (s) => `\x1b[96m${s}\x1b[0m`,
  yellow: (s) => `\x1b[93m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function configDir(args) {
  if (args.dir) return resolve(args.dir);
  const xdg = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim();
  return join(xdg || join(homedir(), ".config"), "opencode");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj, dryRun) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  if (dryRun) {
    console.log(C.dim(`  would write ${file}:`));
    console.log(
      text
        .split("\n")
        .map((l) => C.dim("    " + l))
        .join("\n"),
    );
    return;
  }
  if (existsSync(file)) {
    try {
      copyFileSync(file, backupPath(file));
    } catch {
      /* best-effort backup */
    }
  }
  writeFileSync(file, text);
}

function backupPath(file) {
  let n = 0;
  let candidate = `${file}.bak`;
  while (existsSync(candidate)) candidate = `${file}.bak.${++n}`;
  return candidate;
}

function pluginName(entry) {
  return Array.isArray(entry) ? entry[0] : entry;
}

function printManual() {
  console.log(`${C.bold("Manual install")} — add to your OpenCode config dir (e.g. ~/.config/opencode):

  ${C.cyan("tui.json")}
    { "$schema": "https://opencode.ai/tui.json", "plugin": ["${PKG_NAME}"] }

  ${C.cyan("package.json")} (so the TUI can resolve it from node_modules)
    { "dependencies": { "${PKG_NAME}": "latest" } }

  then run ${C.cyan("npm install")} in that directory and restart the OpenCode TUI.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.print) return printManual();

  const dir = configDir(args);
  const tuiPath = join(dir, "tui.json");
  const pkgPath = join(dir, "package.json");

  console.log(C.bold(`opencode-tps-meter installer`));
  console.log(C.dim(`  config dir: ${dir}`));

  if (!existsSync(dir)) {
    if (args.dryRun) console.log(C.dim(`  would create ${dir}`));
    else mkdirSync(dir, { recursive: true });
  }

  // ── tui.json: the plugin list the TUI reads ────────────────────────────────
  const tui = readJson(tuiPath, { $schema: "https://opencode.ai/tui.json" });
  if (!Array.isArray(tui.plugin)) tui.plugin = [];
  const had = tui.plugin.some((p) => pluginName(p) === PKG_NAME);

  if (args.uninstall) {
    if (!had) {
      console.log(C.yellow(`  ${PKG_NAME} is not in tui.json — nothing to remove.`));
      return;
    }
    tui.plugin = tui.plugin.filter((p) => pluginName(p) !== PKG_NAME);
    writeJson(tuiPath, tui, args.dryRun);
    const pkg = readJson(pkgPath, {});
    if (pkg.dependencies && Object.hasOwn(pkg.dependencies, PKG_NAME)) {
      delete pkg.dependencies[PKG_NAME];
      writeJson(pkgPath, pkg, args.dryRun);
    }
    console.log(C.green(`  ✓ removed ${PKG_NAME} from tui.json and package.json`));
    return;
  }

  if (!had) {
    tui.plugin.push(PKG_NAME);
    writeJson(tuiPath, tui, args.dryRun);
    console.log(C.green(`  ✓ added ${PKG_NAME} to tui.json`));
  } else {
    console.log(C.dim(`  • tui.json already lists ${PKG_NAME}`));
  }

  // ── package.json: how node resolves the package from node_modules ───────────
  const spec = args.local ? `file:${REPO_ROOT}` : npmSpec();
  const pkg = readJson(pkgPath, {});
  if (!pkg.dependencies || typeof pkg.dependencies !== "object") pkg.dependencies = {};
  if (pkg.dependencies[PKG_NAME] !== spec) {
    pkg.dependencies[PKG_NAME] = spec;
    writeJson(pkgPath, pkg, args.dryRun);
    console.log(C.green(`  ✓ set dependency ${PKG_NAME} → ${spec}`));
  } else {
    console.log(C.dim(`  • package.json already depends on ${PKG_NAME} (${spec})`));
  }

  // ── npm install so node_modules is populated ───────────────────────────────
  if (args.noInstall || args.dryRun) {
    console.log(C.yellow(`  ↷ skipped npm install (${args.dryRun ? "dry run" : "--no-install"})`));
    console.log(C.dim(`    run \`npm install\` in ${dir} to finish.`));
  } else {
    console.log(C.dim(`  • running npm install in ${dir} …`));
    try {
      execFileSync("npm", ["install"], { cwd: dir, stdio: "inherit" });
      console.log(C.green(`  ✓ npm install complete`));
    } catch (err) {
      console.log(C.yellow(`  ! npm install failed: ${err?.message || err}`));
      console.log(C.dim(`    finish manually: cd ${dir} && npm install`));
      process.exitCode = 1;
      return;
    }
  }

  console.log("");
  console.log(C.green(`Done.`) + ` Restart the OpenCode TUI — the ${C.cyan("TPS")} section appears in the sidebar.`);
}

/** Pick an npm version spec: the local package's version as a caret range, else "latest". */
function npmSpec() {
  try {
    const v = readJson(join(REPO_ROOT, "package.json"), {}).version;
    return v ? `^${v}` : "latest";
  } catch {
    return "latest";
  }
}

try {
  main();
} catch (err) {
  console.error(C.yellow(`  ! ${err?.message || err}`));
  process.exit(1);
}
