import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView, renderText } from "../plugins/tps/view.js";
import { messageStats, aggregate } from "../plugins/tps/tps.js";

const LAST_MSG = {
  id: "m1",
  role: "assistant",
  modelID: "claude",
  providerID: "anthropic",
  cost: 0.0123,
  time: { created: 1000, completed: 3500 },
  tokens: { input: 1000, output: 312, reasoning: 0, cache: { read: 0, write: 0 } },
};

test("no activity renders nothing", () => {
  const v = buildView({ live: null, last: null, session: null, status: "idle" });
  assert.equal(v.state, "none");
  assert.deepEqual(v.lines, []);
  assert.equal(renderText(v), "");
});

test("idle-with-history projects exact, provider-reported lines", () => {
  const last = messageStats(LAST_MSG, 1420); // ttft 420ms, decode 2080ms -> 150 tok/s
  const session = aggregate([last]);
  const v = buildView({ live: null, last, session, status: "idle" });
  assert.equal(v.state, "idle");
  assert.equal(
    renderText(v),
    [
      "TPS  150 tok/s",
      "last 150 tok/s  ttft 420ms · 312 tok · 2.1s",
      "avg  150 tok/s  peak 150",
      "Σ    312 tok · 1 msg · $0.012",
    ].join("\n"),
  );
});

test("streaming projects the live headline, sparkline, and running totals", () => {
  const live = {
    rate: 120,
    smooth: 118,
    peak: 130,
    total: 240,
    count: 20,
    active: true,
    series: [0, 30, 60, 90, 120],
    elapsedSec: 2,
  };
  const v = buildView({ live, last: null, session: null, status: "busy" });
  assert.equal(v.state, "live");
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.equal(lines[0], "TPS  120 tok/s"); // no emoji, no live/last badge
  assert.equal(lines[1].length, 24); // sparkline rendered at default width
  assert.ok(lines[1].endsWith("█")); // peak value tops out
  assert.equal(lines[2], "now  240 tok · peak 130");
});

test("live headline segment is toned 'accent', idle is 'value'", () => {
  const live = { rate: 80, smooth: 80, peak: 80, total: 100, count: 5, active: true, series: [80], elapsedSec: 1 };
  const liveView = buildView({ live, status: "busy" });
  const headlineTone = liveView.lines[0].segments.find((s) => s.text === "80").tone;
  assert.equal(headlineTone, "accent");

  const last = messageStats(LAST_MSG, 1420);
  const idleView = buildView({ last, session: aggregate([last]), status: "idle" });
  const idleTone = idleView.lines[0].segments.find((s) => s.text === "150").tone;
  assert.equal(idleTone, "value");
});

test("session status is authoritative over the meter's trailing window", () => {
  // A completed message whose 3s rate window has NOT yet drained: meter still
  // reports active, but status==="idle" -> must render the exact 'last', not live.
  const drainingButDone = {
    rate: 77,
    smooth: 77,
    peak: 187,
    total: 900,
    count: 200,
    active: true, // window not drained
    series: [180, 150, 120, 90, 60],
    elapsedSec: 5,
  };
  const last = messageStats(LAST_MSG, 1420);
  const v = buildView({ live: drainingButDone, last, session: aggregate([last]), status: "idle" });
  assert.equal(v.state, "idle");
  const header = v.lines[0].segments.map((s) => s.text).join("");
  // headline number is the exact last (150), not the draining live (77)
  assert.ok(header.includes("150"));
  assert.ok(!header.includes("77"));
  // the exact-last detail row is still present
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.ok(lines.some((l) => l.startsWith("last 150 tok/s")));
});

test("busy status forces live even if the meter just started (no window yet)", () => {
  const justStarted = { rate: 40, smooth: 40, peak: 40, total: 12, count: 2, active: false, series: [40], elapsedSec: 0.1 };
  const v = buildView({ live: justStarted, last: null, session: null, status: "busy" });
  assert.equal(v.state, "live");
  // headline is the live rate, toned 'accent' (the only live/idle cue now that the badge is gone)
  const headline = v.lines[0].segments.find((s) => s.text === "40");
  assert.ok(headline && headline.tone === "accent");
});

test("minimal detail emits only header (+ sparkline)", () => {
  const last = messageStats(LAST_MSG, 1420);
  const v = buildView({ last, session: aggregate([last]), status: "idle", config: { detail: "minimal" } });
  assert.equal(v.lines.length, 1); // header only (no live series present)
  assert.ok(v.lines[0].segments.some((s) => s.text.includes("TPS")));
});

test("metric:generated headlines generated TPS", () => {
  const msg = {
    ...LAST_MSG,
    tokens: { input: 0, output: 200, reasoning: 104, cache: { read: 0, write: 0 } },
  };
  const last = messageStats(msg, 1420); // decode 2080ms -> generated 304/2.08 ~= 146.2
  const v = buildView({ last, session: aggregate([last]), status: "idle", config: { metric: "generated" } });
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  // generated TPS = 304 / 2.08 = 146.15... -> fmtRate rounds (>=100) to "146"
  assert.ok(lines[0].includes("146"));
  assert.ok(lines[1].startsWith("last 146 tok/s"));
});
