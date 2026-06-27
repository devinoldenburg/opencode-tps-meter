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

test("no activity keeps the section visible with a waiting placeholder", () => {
  const v = buildView({ live: null, last: null, session: null, status: "idle" });
  assert.equal(v.state, "idle");
  assert.equal(renderText(v), ["TPS", "waiting for tokens"].join("\n"));
});

test("minimal detail keeps only the TPS label before any tokens arrive", () => {
  const v = buildView({ live: null, last: null, session: null, status: "idle", config: { detail: "minimal" } });
  assert.equal(v.state, "idle");
  assert.equal(renderText(v), "TPS");
});

test("idle-with-history projects throughput + timing only (no native-dup stats)", () => {
  const last = messageStats(LAST_MSG, 1420); // ttft 420ms, decode 2080ms -> 150 tok/s
  const session = aggregate([last]);
  const v = buildView({ live: null, last, session, status: "idle", config: { detail: "full" } });
  assert.equal(v.state, "idle");
  assert.equal(
    renderText(v),
    [
      "TPS  150 tok/s",
      "last 150 tok/s  ttft 420ms",
      "avg  150 tok/s  peak 150",
    ].join("\n"),
  );
});

test("streaming projects the live (active-gen) headline, sparkline, and peak", () => {
  const live = { tps: 120, active: true, peak: 130, series: [0, 30, 60, 90, 120], gaps: 0, idleMs: 0 };
  const v = buildView({ live, last: null, session: null, status: "busy", config: { detail: "full", sparkWidth: 24 } });
  assert.equal(v.state, "live");
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.equal(lines[0], "TPS  120 tok/s");
  assert.equal(lines[1].length, 24);
  assert.ok(lines[1].endsWith("█"));
  assert.equal(lines[2], "now  peak 130 tok/s");
});

test("streaming surfaces excluded wait time when a tool gap occurred", () => {
  const live = { tps: 200, active: true, peak: 240, series: [200], gaps: 1, idleMs: 5000 };
  const v = buildView({ live, status: "busy" });
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.ok(lines.some((l) => l.includes("Wait 5s")), `expected an excluded-wait note in ${JSON.stringify(lines)}`);
});

test("empty detail segments are filtered out", () => {
  const last = messageStats({ ...LAST_MSG, time: { created: 1000, completed: 3500 } });
  const v = buildView({ last, session: aggregate([last]), status: "idle", config: { detail: "full" } });
  assert.equal(v.lines.find((l) => l.key === "last").segments.some((s) => s.text === ""), false);
});

test("streaming with history shows both live and last details", () => {
  const last = messageStats(LAST_MSG, 1420);
  const live = { tps: 80, active: true, peak: 90, series: [80], gaps: 0, idleMs: 0 };
  const v = buildView({ live, last, session: aggregate([last]), status: "busy", config: { detail: "full" } });
  const keys = v.lines.map((l) => l.key);
  assert.ok(keys.includes("last"));
  assert.ok(keys.includes("live-detail"));
});

test("live headline segment is toned 'accent', idle is 'value'", () => {
  const live = { tps: 80, active: true, peak: 80, series: [80], gaps: 0, idleMs: 0 };
  const liveView = buildView({ live, status: "busy" });
  const headlineTone = liveView.lines.flatMap((l) => l.segments).find((s) => s.text === "80").tone;
  assert.equal(headlineTone, "accent");

  const last = messageStats(LAST_MSG, 1420);
  const idleView = buildView({ last, session: aggregate([last]), status: "idle" });
  const idleTone = idleView.lines.flatMap((l) => l.segments).find((s) => s.text === "150").tone;
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
  const v = buildView({ live: drainingButDone, last, session: aggregate([last]), status: "idle", config: { detail: "full" } });
  assert.equal(v.state, "idle");
  const header = v.lines[0].segments.map((s) => s.text).join("");
  assert.ok(header.includes("150"));
  assert.ok(!header.includes("77"));
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.ok(lines.some((l) => l.startsWith("last 150 tok/s")));
});

test("busy status forces live even if the meter just started (no window yet)", () => {
  const justStarted = { tps: 40, active: false, peak: 40, series: [40], gaps: 0, idleMs: 0 };
  const v = buildView({ live: justStarted, last: null, session: null, status: "busy" });
  assert.equal(v.state, "live");
  // headline is the live rate, toned 'accent' (the only live/idle cue now that the badge is gone)
  const headline = v.lines.flatMap((l) => l.segments).find((s) => s.text === "40");
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
  const v = buildView({ last, session: aggregate([last]), status: "idle", config: { metric: "generated", detail: "full" } });
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.ok(lines[0].includes("146.2"));
  assert.ok(lines[1].startsWith("last 146.2 tok/s"));
});

test("compact default: idle shows headline + one timing footer (no redundant avg)", () => {
  const last = messageStats(LAST_MSG, 1420);
  const session = aggregate([last]);
  const v = buildView({ live: null, last, session, status: "idle" });
  assert.equal(renderText(v), ["TPS", "150 tok/s", "TTFT 420ms"].join("\n"));
});

test("compact streaming: sparkline + peak footer when peak differs", () => {
  const live = { tps: 120, active: true, peak: 130, series: [0, 30, 60, 90, 120], gaps: 0, idleMs: 0 };
  const v = buildView({ live, status: "busy" });
  const lines = v.lines.map((l) => l.segments.map((s) => s.text).join(""));
  assert.equal(lines[0], "TPS");
  assert.equal(lines[1], "120 tok/s");
  assert.equal(lines[2].length, 16);
  assert.equal(lines[3], "Peak 130");
});
