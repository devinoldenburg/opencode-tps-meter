import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerationTimer } from "../plugins/tps/gen.js";
import { messageStats, aggregate } from "../plugins/tps/tps.js";
import { buildView, renderText } from "../plugins/tps/view.js";

/**
 * Full pipeline, the way the plugin runs it: a simulated OpenCode server streams a
 * turn at a known generation rate, interrupted by a tool call, then completes with
 * an exact token count. The GenerationTimer measures active-generation time; that
 * timing feeds messageStats / aggregate; buildView renders the sidebar. We assert
 * the rendered numbers are the TRUE generation rate (not wall-clock), the tool wait
 * is surfaced as excluded, and no natively-shown stats (tokens/cost) leak in.
 */
test("END-TO-END: rendered sidebar shows the true generation rate, excludes the tool wait", () => {
  const C = 4; // tokens per streamed chunk
  const G = 20; // ms between chunks  => TRUE rate = 200 tok/s
  const TRUE_TPS = (C / G) * 1000;
  const CREATED = 0;
  const TTFT = 500; // prefill before the first token
  const TOOL_GAP = 4000; // a 4s tool call mid-turn
  const K = 50; // chunks per burst (two bursts)

  const timer = new GenerationTimer();
  let t = CREATED + TTFT;
  let total = 0;
  for (let burst = 0; burst < 2; burst++) {
    for (let i = 0; i < K; i++) {
      timer.push(C, t);
      total += C;
      t += G;
    }
    // t is one G past this burst's last chunk; the tool call makes the NEXT burst's
    // first chunk arrive exactly TOOL_GAP after the last chunk.
    if (burst === 0) t = t - G + TOOL_GAP;
  }
  const lastAt = t - G;
  const completed = lastAt + 40;

  // The completed assistant message as OpenCode reports it (exact provider counts).
  const msg = {
    id: "m1",
    role: "assistant",
    modelID: "demo",
    providerID: "demo",
    cost: 0.01,
    time: { created: CREATED, completed },
    tokens: { input: 1000, output: total, reasoning: 0, cache: { read: 0, write: 0 } },
  };

  const timing = {
    firstTokenAt: timer.firstAt,
    activeMs: timer.activeMs,
    idleMs: timer.idleMs,
    gaps: timer.gaps,
    primeTokens: timer.primeTokens,
  };
  const last = messageStats(msg, timing);

  // Exact generation rate — the 4s tool wait is invisible to TPS.
  assert.equal(last.decodeSource, "active");
  assert.equal(last.gaps, 1);
  assert.equal(last.idleMs, TOOL_GAP);
  assert.ok(Math.abs(last.generatedTps - TRUE_TPS) < 1e-9, `generatedTps ${last.generatedTps} ≈ ${TRUE_TPS}`);
  assert.equal(last.ttftMs, TTFT);

  // The naive end-to-end rate (tokens / whole-turn time) is badly polluted.
  assert.ok(last.e2eTps < TRUE_TPS / 2);
  assert.ok(last.generatedTps > last.e2eTps * 3);

  // Session average pools the same prime-corrected decode tokens → still exact.
  const session = aggregate([last]);
  assert.ok(Math.abs(session.avgGeneratedTps - TRUE_TPS) < 1e-9);

  // Rendered sidebar: throughput + TTFT + excluded wait, and nothing OpenCode
  // already shows natively (no token totals, no cost).
  const v = buildView({ live: null, last, session, status: "idle" });
  assert.equal(renderText(v), ["TPS", "200 tok/s", "TTFT 500ms  ·  Wait 4s"].join("\n"));
  const text = renderText(v);
  assert.ok(!text.includes("$"), "no cost (native Context shows it)");
  assert.ok(!/\bmsg\b/.test(text), "no message-count totals by default");
});

test("END-TO-END: a clean turn with no tools renders just throughput + TTFT", () => {
  const timer = new GenerationTimer();
  let t = 300; // TTFT
  for (let i = 0; i < 100; i++) {
    timer.push(5, t); // 5 tok / 25ms = 200 tok/s
    t += 25;
  }
  const msg = {
    id: "m2",
    role: "assistant",
    modelID: "demo",
    providerID: "demo",
    cost: 0,
    time: { created: 0, completed: t },
    tokens: { input: 0, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const last = messageStats(msg, {
    firstTokenAt: timer.firstAt,
    activeMs: timer.activeMs,
    idleMs: timer.idleMs,
    gaps: timer.gaps,
    primeTokens: timer.primeTokens,
  });
  assert.ok(Math.abs(last.generatedTps - 200) < 1e-9);
  const v = buildView({ live: null, last, session: aggregate([last]), status: "idle" });
  assert.ok(!renderText(v).includes("wait"));
  assert.equal(renderText(v), "TPS\n200 tok/s\nTTFT 300ms");
});
