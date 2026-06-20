import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, DEFAULTS } from "../plugins/tps/config.js";

test("defaults when given nothing", () => {
  const c = resolveConfig(undefined, {});
  assert.equal(c.enabled, true);
  assert.equal(c.order, 150);
  assert.equal(c.slot, "sidebar_content");
  assert.equal(c.metric, "generated");
  assert.equal(c.detail, "full");
  assert.equal(c.windowMs, 3000);
  assert.equal(c.gapMs, 1500);
  assert.equal(c.pollMs, 250);
  assert.equal(c.showCost, false); // native Context already shows cost
  assert.equal(c.showTotals, false);
  assert.equal(c.showWaits, true);
});

test("options override defaults", () => {
  const c = resolveConfig(
    { order: 250, metric: "generated", detail: "compact", windowMs: 5000, label: "Speed", showCost: false },
    {},
  );
  assert.equal(c.order, 250);
  assert.equal(c.metric, "generated");
  assert.equal(c.detail, "compact");
  assert.equal(c.windowMs, 5000);
  assert.equal(c.label, "Speed");
  assert.equal(c.showCost, false);
});

test("env can disable and override", () => {
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_DISABLE: "1" }).enabled, false);
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER: "off" }).enabled, false);
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_METRIC: "generated" }).metric, "generated");
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_SLOT: "sidebar_footer" }).slot, "sidebar_footer");
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_WINDOW_MS: "1500" }).windowMs, 1500);
});

test("options.enabled:false disables", () => {
  assert.equal(resolveConfig({ enabled: false }, {}).enabled, false);
});

test("invalid values fall back to defaults / clamps", () => {
  const c = resolveConfig({ detail: "bogus", windowMs: "nope", pollMs: 5, seriesLength: 0, metric: "weird" }, {});
  assert.equal(c.detail, DEFAULTS.detail);
  assert.equal(c.windowMs, DEFAULTS.windowMs); // non-numeric -> default
  assert.equal(c.pollMs, 50); // clamped to floor
  assert.equal(c.seriesLength, 1); // clamped to floor
  assert.equal(c.metric, "generated"); // unknown -> generated (default)
});

test("metric defaults to generated; either source can opt into 'output'", () => {
  assert.equal(resolveConfig({}, {}).metric, "generated");
  assert.equal(resolveConfig({ metric: "output" }, {}).metric, "output");
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_METRIC: "output" }).metric, "output");
  assert.equal(resolveConfig({ metric: "generated" }, { OPENCODE_TPS_METER_METRIC: "output" }).metric, "output");
});

test("gapMs override + clamp", () => {
  assert.equal(resolveConfig({ gapMs: 2500 }, {}).gapMs, 2500);
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_GAP_MS: "800" }).gapMs, 800);
  assert.equal(resolveConfig({ gapMs: 10 }, {}).gapMs, 100); // clamped to floor
});

test("colors object passes through, non-object ignored", () => {
  assert.deepEqual(resolveConfig({ colors: { accent: "#ff0000" } }, {}).colors, { accent: "#ff0000" });
  assert.equal(resolveConfig({ colors: "red" }, {}).colors, null);
});
