#!/usr/bin/env node
/**
 * demo.mjs — replay a synthetic streaming turn through the real measurement core
 * (RateMeter + messageStats + buildView) and render the meter to the terminal.
 *
 * This is the same pipeline the TUI plugin uses; only the final paint differs
 * (ANSI here vs. @opentui/solid in the TUI). It doubles as an integration smoke
 * test: `node tools/demo.mjs --ci` runs in virtual time, prints representative
 * frames, and exits non-zero if anything throws.
 *
 * Usage:
 *   node tools/demo.mjs                 # animated, ~8s
 *   node tools/demo.mjs --tps 220 --tokens 1200
 *   node tools/demo.mjs --ci            # fast, deterministic, non-animated
 */

import { RateMeter } from "../plugins/tps/meter.js";
import { messageStats, aggregate, tokensFromChars, calibrateRatio } from "../plugins/tps/tps.js";
import { buildView, renderText } from "../plugins/tps/view.js";

const args = parseArgs(process.argv.slice(2));
const TPS = num(args.tps, 180);
const TOKENS = num(args.tokens, 900);
const RATIO = num(args.ratio, 3.8); // chars/token used to synthesize chunk sizes
const TTFT_MS = num(args.ttft, 650);
const POLL_MS = 120;
const CI = "ci" in args || !process.stdout.isTTY;

const ANSI = {
  header: "\x1b[1;97m",
  accent: "\x1b[96m",
  value: "\x1b[97m",
  good: "\x1b[92m",
  warn: "\x1b[93m",
  muted: "\x1b[90m",
  label: "\x1b[90m",
  reset: "\x1b[0m",
};

// Deterministic-ish PRNG so --ci output is stable across runs.
let seed = 1337;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** Build the chunk schedule (arrival ms relative to request start + char count). */
function buildSchedule() {
  const chunks = [];
  let t = TTFT_MS;
  let produced = 0;
  while (produced < TOKENS) {
    const n = Math.min(TOKENS - produced, 3 + Math.floor(rnd() * 6));
    const gap = (n / TPS) * 1000 * (0.6 + rnd() * 0.8);
    t += gap;
    produced += n;
    chunks.push({ t: Math.round(t), chars: Math.max(1, Math.round(n * RATIO)) });
  }
  const completedAt = (chunks.at(-1)?.t ?? TTFT_MS) + 40;
  return { chunks, completedAt };
}

function finalMessage(completedAt) {
  return {
    id: "demo-msg",
    role: "assistant",
    modelID: "demo/sonnet",
    providerID: "demo",
    cost: (TOKENS / 1_000_000) * 9, // ~$9 / Mtok output, illustrative
    time: { created: 0, completed: completedAt },
    tokens: { input: 4200, output: TOKENS, reasoning: 0, cache: { read: 3000, write: 200 } },
  };
}

function colorize(view) {
  return view.lines
    .map((line) => line.segments.map((s) => `${ANSI[s.tone] || ""}${s.text}${ANSI.reset}`).join(""))
    .join("\n");
}

function frameFor(meter, now, schedule, finished) {
  const last = finished ? messageStats(finalMessage(schedule.completedAt), TTFT_MS) : null;
  const session = aggregate(last ? [last] : []);
  const status = finished ? "idle" : "busy";
  return buildView({ live: meter.snapshot(now), last, session, status, config: { sparkWidth: 28 } });
}

async function animate() {
  const schedule = buildSchedule();
  const meter = new RateMeter({ windowMs: 3000, seriesLength: 28 });
  let ratio = RATIO;
  const start = Date.now();
  let fed = 0;
  let finished = false;
  let firstTokenAt = null;

  process.stdout.write("\x1b[?25l"); // hide cursor
  const cleanup = () => process.stdout.write("\x1b[?25h\n"); // show cursor
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const now = Date.now() - start;
      while (fed < schedule.chunks.length && schedule.chunks[fed].t <= now) {
        const c = schedule.chunks[fed++];
        if (firstTokenAt === null) firstTokenAt = c.t;
        meter.push(tokensFromChars(c.chars, ratio), start + c.t);
      }
      meter.sample(Date.now());
      if (!finished && now >= schedule.completedAt) {
        finished = true;
        // recalibrate ratio from the exact token count, as the plugin does
        const chars = schedule.chunks.reduce((a, c) => a + c.chars, 0);
        ratio = calibrateRatio(ratio, chars, TOKENS);
      }
      const view = frameFor(meter, Date.now(), schedule, finished);
      render(colorize(view));
      // end ~1.8s after completion (let the live line decay to idle)
      if (finished && now >= schedule.completedAt + 1800) {
        clearInterval(timer);
        resolve();
      }
    }, POLL_MS);
  });
  cleanup();
}

let lastHeight = 0;
function render(text) {
  if (lastHeight) process.stdout.write(`\x1b[${lastHeight}A`);
  const lines = `${ANSI.muted}── opencode-tps-meter · live demo ──${ANSI.reset}\n${text}`.split("\n");
  lastHeight = lines.length;
  process.stdout.write(lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
}

function runCi() {
  const schedule = buildSchedule();
  const meter = new RateMeter({ windowMs: 3000, seriesLength: 28 });
  let ratio = RATIO;
  const frames = [];
  const stops = [TTFT_MS + 400, Math.round(schedule.completedAt * 0.6), schedule.completedAt + 1600];
  let fed = 0;
  let next = 0;
  for (let now = 0; now <= schedule.completedAt + 2000; now += POLL_MS) {
    while (fed < schedule.chunks.length && schedule.chunks[fed].t <= now) {
      const c = schedule.chunks[fed++];
      meter.push(tokensFromChars(c.chars, ratio), c.t);
    }
    meter.sample(now);
    const finished = now >= schedule.completedAt;
    if (finished && ratio === RATIO) {
      const chars = schedule.chunks.reduce((a, c) => a + c.chars, 0);
      ratio = calibrateRatio(ratio, chars, TOKENS);
    }
    if (next < stops.length && now >= stops[next]) {
      frames.push({ label: ["warmup", "mid-stream", "idle"][next], view: frameFor(meter, now, schedule, finished) });
      next++;
    }
  }
  for (const f of frames) {
    console.log(`${ANSI.muted}── ${f.label} ──${ANSI.reset}`);
    console.log(colorize(f.view));
    // assert the renderer produced something sane
    const txt = renderText(f.view);
    if (!txt.includes("TPS")) throw new Error(`demo frame "${f.label}" missing TPS header`);
    console.log();
  }
  console.log(`${ANSI.muted}(animated mode: run in a TTY without --ci)${ANSI.reset}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : true;
      out[key] = val;
    }
  }
  return out;
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

try {
  if (CI) runCi();
  else await animate();
} catch (err) {
  console.error("demo failed:", err);
  process.exit(1);
}
