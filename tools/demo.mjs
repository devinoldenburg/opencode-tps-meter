#!/usr/bin/env node
/**
 * demo.mjs — replay a synthetic streaming turn (with a tool-call gap) through the
 * real measurement core and render the meter to the terminal.
 *
 * It exercises the exact pipeline the TUI plugin uses — a GenerationTimer for the
 * precise active-generation rate, a RateMeter for the sparkline, then
 * messageStats / aggregate / buildView — so it doubles as proof that the meter
 * reports generation speed and is blind to the tool call: the headline TPS holds
 * steady across the gap while the sparkline dips.
 *
 * Usage:
 *   node tools/demo.mjs                 # animated, ~9s
 *   node tools/demo.mjs --tps 220 --tokens 1200 --tool 4000
 *   node tools/demo.mjs --ci            # fast, deterministic frames + smoke test
 */

import { RateMeter } from "../plugins/tps/meter.js";
import { GenerationTimer } from "../plugins/tps/gen.js";
import { messageStats, aggregate } from "../plugins/tps/tps.js";
import { buildView, renderText } from "../plugins/tps/view.js";

const args = parseArgs(process.argv.slice(2));
const TPS = num(args.tps, 190);
const TOKENS = num(args.tokens, 900);
const RATIO = num(args.ratio, 3.8); // chars/token used to synthesize chunk sizes
const TTFT_MS = num(args.ttft, 600);
const TOOL_GAP = num(args.tool, 3800); // a mid-turn tool call blocks the stream this long
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

// Deterministic PRNG so --ci output is stable.
let seed = 1337;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** Chunk schedule (arrival ms from request start + char/token counts), with one tool gap. */
function buildSchedule() {
  const chunks = [];
  let t = TTFT_MS;
  let produced = 0;
  const toolAt = Math.floor(TOKENS * 0.45);
  let toolDone = false;
  while (produced < TOKENS) {
    if (!toolDone && produced >= toolAt) {
      t += TOOL_GAP; // the model stops emitting while a tool runs
      toolDone = true;
    }
    const n = Math.min(TOKENS - produced, 3 + Math.floor(rnd() * 6));
    t += (n / TPS) * 1000 * (0.6 + rnd() * 0.8);
    produced += n;
    chunks.push({ t: Math.round(t), chars: Math.max(1, Math.round(n * RATIO)), tokens: n });
  }
  return { chunks, completedAt: (chunks.at(-1)?.t ?? TTFT_MS) + 40 };
}

function finalMessage(completedAt) {
  return {
    id: "demo-msg",
    role: "assistant",
    modelID: "demo/sonnet",
    providerID: "demo",
    cost: (TOKENS / 1_000_000) * 9,
    time: { created: 0, completed: completedAt },
    tokens: { input: 4200, output: TOKENS, reasoning: 0, cache: { read: 3000, write: 200 } },
  };
}

function timingOf(timer) {
  return {
    firstTokenAt: timer.firstAt,
    activeMs: timer.activeMs,
    idleMs: timer.idleMs,
    gaps: timer.gaps,
    primeTokens: timer.primeTokens,
  };
}

function colorize(view) {
  return view.lines
    .map((line) => line.segments.map((s) => `${ANSI[s.tone] || ""}${s.text}${ANSI.reset}`).join(""))
    .join("\n");
}

function frameFor(timer, meter, schedule, now, finished) {
  const live = finished
    ? null
    : {
        tps: timer.tps(),
        active: meter.active(now),
        series: meter.series(),
        peak: meter.peak,
        gaps: timer.gaps,
        idleMs: timer.idleMs,
      };
  const last = finished ? messageStats(finalMessage(schedule.completedAt), timingOf(timer)) : null;
  const session = aggregate(last ? [last] : []);
  return buildView({ live, last, session, status: finished ? "idle" : "busy", config: { sparkWidth: 28 } });
}

async function animate() {
  const schedule = buildSchedule();
  const meter = new RateMeter({ windowMs: 3000, seriesLength: 28 });
  const timer = new GenerationTimer();
  const start = Date.now();
  let fed = 0;
  let finished = false;

  process.stdout.write("\x1b[?25l");
  const cleanup = () => process.stdout.write("\x1b[?25h\n");
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  await new Promise((resolve) => {
    const id = setInterval(() => {
      const now = Date.now() - start;
      while (fed < schedule.chunks.length && schedule.chunks[fed].t <= now) {
        const c = schedule.chunks[fed++];
        const tok = c.tokens;
        timer.push(tok, c.t);
        meter.push(tok, c.t);
      }
      meter.sample(now);
      if (!finished && now >= schedule.completedAt) finished = true;
      render(colorize(frameFor(timer, meter, schedule, now, finished)));
      if (finished && now >= schedule.completedAt + 1800) {
        clearInterval(id);
        resolve();
      }
    }, POLL_MS);
  });
  cleanup();
}

let lastHeight = 0;
function render(text) {
  if (lastHeight) process.stdout.write(`\x1b[${lastHeight}A`);
  const lines = `${ANSI.muted}── opencode-tps-meter · live demo (tool call mid-turn) ──${ANSI.reset}\n${text}`.split("\n");
  lastHeight = lines.length;
  process.stdout.write(lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
}

function runCi() {
  const schedule = buildSchedule();
  const meter = new RateMeter({ windowMs: 3000, seriesLength: 28 });
  const timer = new GenerationTimer();
  const toolStart = schedule.chunks.find((_, i) => i > 0 && schedule.chunks[i].t - schedule.chunks[i - 1].t >= TOOL_GAP);
  const stops = [
    { label: "warmup", at: TTFT_MS + 500 },
    { label: "during tool call", at: (toolStart ? toolStart.t : schedule.completedAt) - 200 },
    { label: "after resume", at: Math.round(schedule.completedAt * 0.9) },
    { label: "idle (turn complete)", at: schedule.completedAt + 1600 },
  ];
  const frames = [];
  let fed = 0;
  let next = 0;
  for (let now = 0; now <= schedule.completedAt + 2000; now += POLL_MS) {
    while (fed < schedule.chunks.length && schedule.chunks[fed].t <= now) {
      const c = schedule.chunks[fed++];
      const tok = c.tokens;
      timer.push(tok, c.t);
      meter.push(tok, c.t);
    }
    meter.sample(now);
    const finished = now >= schedule.completedAt;
    while (next < stops.length && now >= stops[next].at) {
      frames.push({ label: stops[next].label, view: frameFor(timer, meter, schedule, now, finished) });
      next++;
    }
  }
  for (const f of frames) {
    console.log(`${ANSI.muted}── ${f.label} ──${ANSI.reset}`);
    console.log(colorize(f.view));
    if (!renderText(f.view).split("\n")[0]?.startsWith("TPS")) throw new Error(`demo frame "${f.label}" missing TPS header`);
    console.log();
  }
  console.log(`${ANSI.muted}(headline TPS holds across the tool call; the sparkline dips. Animate: run in a TTY without --ci)${ANSI.reset}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : true;
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
  process.stdout.write("\x1b[?25h");
  console.error("demo failed:", err);
  process.exit(1);
}
