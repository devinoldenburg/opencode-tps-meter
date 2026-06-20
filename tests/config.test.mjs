import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, DEFAULTS } from "../plugins/tps/config.js";

test("defaults when given nothing", () => {
  const c = resolveConfig(undefined, {});
  assert.equal(c.enabled, true);
  assert.equal(c.order, 150);
  assert.equal(c.slot, "sidebar_content");
  assert.equal(c.metric, "output");
  assert.equal(c.detail, "full");
  assert.equal(c.windowMs, 3000);
  assert.equal(c.pollMs, 250);
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
  assert.equal(c.metric, "output"); // unknown -> output
});

test("metric uses OR-semantics: either source can opt into 'generated'", () => {
  assert.equal(resolveConfig({ metric: "generated" }, {}).metric, "generated");
  assert.equal(resolveConfig({}, { OPENCODE_TPS_METER_METRIC: "generated" }).metric, "generated");
  assert.equal(resolveConfig({ metric: "output" }, { OPENCODE_TPS_METER_METRIC: "generated" }).metric, "generated");
  assert.equal(resolveConfig({ metric: "output" }, {}).metric, "output");
});

test("colors object passes through, non-object ignored", () => {
  assert.deepEqual(resolveConfig({ colors: { accent: "#ff0000" } }, {}).colors, { accent: "#ff0000" });
  assert.equal(resolveConfig({ colors: "red" }, {}).colors, null);
});
