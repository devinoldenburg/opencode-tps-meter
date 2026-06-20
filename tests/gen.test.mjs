import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerationTimer, DEFAULT_GAP_THRESHOLD_MS } from "../plugins/tps/gen.js";

test("needs a measurable active span before reporting", () => {
  const g = new GenerationTimer();
  assert.equal(g.tps(), null);
  g.push(10, 1000);
  assert.equal(g.tps(), null); // one chunk: no interval yet
  assert.equal(g.activeMs, 0);
});

test("active time is the sum of small inter-chunk gaps; prime chunk excluded", () => {
  const g = new GenerationTimer();
  // 11 chunks, 10 tokens each, 100ms apart => 10 active intervals = 1000ms
  for (let t = 0; t <= 1000; t += 100) g.push(10, t);
  assert.equal(g.activeMs, 1000);
  assert.equal(g.tokens, 110);
  assert.equal(g.decodeTokens, 100); // first (prime) chunk's 10 tokens excluded
  assert.equal(g.tps(), 100); // exactly the true 10 tok / 100ms = 100 tok/s
  assert.equal(g.idleMs, 0);
  assert.equal(g.gaps, 0);
});

test("a tool-call gap is excluded — TPS reflects generation, not the wait", () => {
  const g = new GenerationTimer(); // default 1500ms threshold
  for (let t = 0; t <= 1000; t += 100) g.push(10, t); // burst 1: 1000ms active, 110 tok
  g.push(10, 11000); // 10s tool call -> excluded idle gap, resume (prime)
  g.push(10, 11100);
  g.push(10, 11200); // burst 2: +200ms active
  assert.equal(g.activeMs, 1200); // 10s tool wait NOT counted
  assert.equal(g.idleMs, 10000);
  assert.equal(g.gaps, 1);
  assert.equal(g.decodeTokens, 120); // two prime chunks (start + resume) excluded: 140 - 20
  assert.equal(g.tps(), 100); // still exactly 100 tok/s — the wait is invisible to TPS

  // The naive wall-clock rate would be badly wrong:
  const naive = 140 / ((11200 - 0) / 1000); // 12.5 tok/s
  assert.ok(g.tps() > naive * 7);
});

test("setTokens makes the rate exact at completion without changing measured time", () => {
  const g = new GenerationTimer();
  for (let t = 0; t <= 500; t += 50) g.push(7, t); // estimated tokens
  const activeBefore = g.activeMs;
  g.setTokens(80); // exact provider count (prime offset = 7)
  assert.equal(g.activeMs, activeBefore); // time untouched
  assert.equal(g.decodeTokens, 73); // 80 - 7 prime
  assert.equal(g.tps(), 73 / (activeBefore / 1000));
});

test("gap threshold boundary is exclusive of the threshold", () => {
  const below = new GenerationTimer({ gapThresholdMs: 1000 });
  below.push(5, 0);
  below.push(5, 999); // 999 < 1000 -> active
  assert.equal(below.activeMs, 999);
  assert.equal(below.gaps, 0);

  const at = new GenerationTimer({ gapThresholdMs: 1000 });
  at.push(5, 0);
  at.push(5, 1000); // 1000 >= 1000 -> idle
  assert.equal(at.activeMs, 0);
  assert.equal(at.idleMs, 1000);
  assert.equal(at.gaps, 1);
});

test("invalid threshold falls back to the default", () => {
  assert.equal(new GenerationTimer({ gapThresholdMs: -5 }).gapThresholdMs, DEFAULT_GAP_THRESHOLD_MS);
  assert.equal(new GenerationTimer({ gapThresholdMs: "x" }).gapThresholdMs, DEFAULT_GAP_THRESHOLD_MS);
});

test("SERVER SIMULATION: constant-rate stream with tool gaps measures the TRUE rate exactly", () => {
  // Simulate the OpenCode server streaming a turn at a known generation rate,
  // interrupted by tool calls. The meter must report the generation rate and be
  // blind to everything the turn waited for.
  const C = 5; // tokens per streamed chunk
  const G = 25; // ms between chunks  => true rate = C/G*1000 = 200 tok/s
  const TRUE_TPS = (C / G) * 1000;
  const TOOL_GAP = 5000; // each tool call blocks the stream for 5s
  const bursts = [40, 50, 30]; // three spans of generation, two tool calls between

  const timer = new GenerationTimer();
  let t = 0;
  let total = 0;
  let firstAt = null;
  for (let b = 0; b < bursts.length; b++) {
    if (b > 0) t += TOOL_GAP; // a tool call: the stream goes quiet
    for (let i = 0; i < bursts[b]; i++) {
      if (firstAt === null) firstAt = t;
      timer.push(C, t);
      total += C;
      t += G;
    }
  }
  const lastAt = t - G;

  // The meter reports the true generation rate to the token, despite two 5s waits.
  assert.ok(Math.abs(timer.tps() - TRUE_TPS) < 1e-9, `measured ${timer.tps()} ≈ ${TRUE_TPS}`);
  assert.equal(timer.gaps, bursts.length - 1); // exactly the two tool calls
  assert.equal(timer.idleMs, (bursts.length - 1) * (TOOL_GAP + G));

  // A naive wall-clock rate (what you'd get without excluding the waits) is far off.
  const naiveWallTps = total / ((lastAt - firstAt) / 1000);
  assert.ok(naiveWallTps < TRUE_TPS / 3, `naive ${naiveWallTps} should badly understate ${TRUE_TPS}`);
  assert.ok(timer.tps() > naiveWallTps * 4);

  // Exactness survives swapping the estimate for the provider's exact token count.
  timer.setTokens(total);
  assert.ok(Math.abs(timer.tps() - TRUE_TPS) < 1e-9);
});
