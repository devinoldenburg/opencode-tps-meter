import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messageStats,
  aggregate,
  calibrateRatio,
  tokensFromChars,
  rate,
  isAssistant,
  DEFAULT_CHARS_PER_TOKEN,
} from "../plugins/tps/tps.js";

function asstMsg(over = {}) {
  return {
    id: "m1",
    role: "assistant",
    modelID: "claude",
    providerID: "anthropic",
    cost: 0.02,
    time: { created: 1000, completed: 4000 },
    tokens: { input: 1000, output: 300, reasoning: 0, cache: { read: 500, write: 10 } },
    ...over,
  };
}

test("rate() basic and guards", () => {
  assert.equal(rate(100, 1000), 100);
  assert.equal(rate(300, 1500), 200);
  assert.equal(rate(100, 0), null);
  assert.equal(rate(100, -5), null);
  assert.equal(rate(NaN, 1000), null);
});

test("isAssistant() discriminates", () => {
  assert.equal(isAssistant(asstMsg()), true);
  assert.equal(isAssistant({ role: "user", tokens: {}, time: {} }), false);
  assert.equal(isAssistant(null), false);
  assert.equal(isAssistant({ role: "assistant" }), false);
});

test("messageStats: completed message without measured TTFT uses end-to-end window", () => {
  const s = messageStats(asstMsg());
  assert.equal(s.done, true);
  assert.equal(s.e2eMs, 3000);
  assert.equal(s.decodeMs, 3000); // falls back to e2e
  assert.equal(s.ttftMs, null);
  assert.equal(s.outputTps, 100); // 300 / 3s
  assert.equal(s.e2eTps, 100);
  assert.equal(s.decodeExcludesPrefill, false);
  assert.equal(s.input, 1000);
  assert.equal(s.cacheRead, 500);
});

test("messageStats: measured TTFT yields decode-only window and TTFT", () => {
  const s = messageStats(asstMsg(), 1500);
  assert.equal(s.ttftMs, 500);
  assert.equal(s.decodeMs, 2500); // 4000 - 1500
  assert.equal(s.outputTps, 120); // 300 / 2.5s
  assert.equal(s.e2eTps, 100); // still over the full 3s
  assert.equal(s.decodeExcludesPrefill, true);
});

test("messageStats: reasoning tokens count toward generated, not output", () => {
  const s = messageStats(
    asstMsg({ tokens: { input: 1000, output: 200, reasoning: 100, cache: { read: 0, write: 0 } } }),
    1500,
  );
  assert.equal(s.output, 200);
  assert.equal(s.reasoning, 100);
  assert.equal(s.generated, 300);
  assert.equal(s.outputTps, 80); // 200 / 2.5
  assert.equal(s.generatedTps, 120); // 300 / 2.5
});

test("messageStats: not-yet-completed message is not measurable", () => {
  const s = messageStats(asstMsg({ time: { created: 1000 } }));
  assert.equal(s.done, false);
  assert.equal(s.e2eMs, null);
  assert.equal(s.outputTps, null);
});

test("messageStats: non-assistant returns null", () => {
  assert.equal(messageStats({ role: "user" }), null);
  assert.equal(messageStats(null), null);
});

test("aggregate pools tokens over time (not a mean of rates)", () => {
  const m1 = messageStats(asstMsg({ id: "a", time: { created: 0, completed: 3000 }, tokens: { input: 0, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } }));
  const m2 = messageStats(asstMsg({ id: "b", time: { created: 0, completed: 3000 }, tokens: { input: 0, output: 600, reasoning: 0, cache: { read: 0, write: 0 } } }));
  const agg = aggregate([m1, m2, null]);
  assert.equal(agg.count, 2);
  assert.equal(agg.output, 900);
  // pooled: 900 tok / 6s = 150 (NOT (100+200)/2 = 150 here by coincidence of equal durations;
  // verify pooling with unequal durations below)
  assert.equal(agg.avgOutputTps, 150);
  assert.equal(agg.peakTps, 200); // m2's generatedTps
});

test("aggregate pooling differs from rate-mean when durations differ", () => {
  // fast short message + slow long message
  const fast = messageStats(asstMsg({ id: "f", time: { created: 0, completed: 1000 }, tokens: { input: 0, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } })); // 300 tps
  const slow = messageStats(asstMsg({ id: "s", time: { created: 0, completed: 9000 }, tokens: { input: 0, output: 900, reasoning: 0, cache: { read: 0, write: 0 } } })); // 100 tps
  const agg = aggregate([fast, slow]);
  // pooled = (300+900) / (1+9)s = 1200/10 = 120
  assert.equal(agg.avgOutputTps, 120);
  // a naive mean of rates would be (300+100)/2 = 200 -> confirm we did NOT do that
  assert.notEqual(agg.avgOutputTps, 200);
});

test("aggregate ignores unfinished messages", () => {
  const done = messageStats(asstMsg({ time: { created: 0, completed: 2000 }, tokens: { input: 0, output: 200, reasoning: 0, cache: { read: 0, write: 0 } } }));
  const pending = messageStats(asstMsg({ time: { created: 0 } }));
  const agg = aggregate([done, pending]);
  assert.equal(agg.count, 1);
  assert.equal(agg.output, 200);
});

test("calibrateRatio: seeds, EWMA-updates, and clamps", () => {
  assert.equal(calibrateRatio(null, 400, 100), 4); // 400/100
  assert.equal(calibrateRatio(4, 1000, 200, 0.3), 4.3); // 4*0.7 + 5*0.3
  assert.equal(calibrateRatio(null, 100, 1), 12); // sample 100 clamps to 12
  assert.equal(calibrateRatio(5, 0, 0), 5); // invalid sample -> keep base
  assert.equal(calibrateRatio(null, 0, 0), DEFAULT_CHARS_PER_TOKEN);
});

test("tokensFromChars uses ratio with sane fallback", () => {
  assert.equal(tokensFromChars(400, 4), 100);
  assert.equal(tokensFromChars(400, 0), 100); // bad ratio -> default 4
  assert.equal(tokensFromChars(0, 4), 0);
});
