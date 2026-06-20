import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtRate,
  fmtInt,
  fmtTokens,
  fmtMs,
  fmtCost,
  sparkline,
  bar,
  trimZero,
  SPARK_CHARS,
} from "../plugins/tps/format.js";

test("fmtRate buckets and placeholder", () => {
  assert.equal(fmtRate(8.4), "8.4");
  assert.equal(fmtRate(8.04), "8");
  assert.equal(fmtRate(12), "12");
  assert.equal(fmtRate(99.6), "99.6");
  assert.equal(fmtRate(100), "100");
  assert.equal(fmtRate(247.6), "248");
  assert.equal(fmtRate(1234), "1.2k");
  assert.equal(fmtRate(0), "0");
  assert.equal(fmtRate(null), "–");
  assert.equal(fmtRate(-1), "–");
  assert.equal(fmtRate(undefined, "?"), "?");
});

test("fmtInt groups thousands", () => {
  assert.equal(fmtInt(1234567), "1,234,567");
  assert.equal(fmtInt(0), "0");
});

test("fmtTokens compacts k/M", () => {
  assert.equal(fmtTokens(950), "950");
  assert.equal(fmtTokens(1500), "1.5k");
  assert.equal(fmtTokens(1234567), "1.2M");
  assert.equal(fmtTokens(2000000), "2M");
});

test("fmtMs scales ms/s/m", () => {
  assert.equal(fmtMs(0), "0ms");
  assert.equal(fmtMs(850), "850ms");
  assert.equal(fmtMs(2400), "2.4s");
  assert.equal(fmtMs(9000), "9s");
  assert.equal(fmtMs(12000), "12s");
  assert.equal(fmtMs(65000), "1m05s");
  assert.equal(fmtMs(-1), "–");
});

test("fmtCost formats by magnitude", () => {
  assert.equal(fmtCost(0), "$0");
  assert.equal(fmtCost(0.005), "$0.0050");
  assert.equal(fmtCost(0.0123), "$0.012");
  assert.equal(fmtCost(0.5), "$0.500");
  assert.equal(fmtCost(1.5), "$1.50");
});

test("sparkline maps a ramp across all glyphs", () => {
  assert.equal(sparkline([0, 1, 2, 3, 4, 5, 6, 7], { width: 8 }), SPARK_CHARS.join(""));
});

test("sparkline pads on the left when short", () => {
  assert.equal(sparkline([10], { width: 3, max: 10 }), "▁▁█");
});

test("sparkline keeps the most recent values when overflowing width", () => {
  const s = sparkline([0, 0, 0, 0, 10], { width: 2, max: 10 });
  assert.equal(s.length, 2);
  assert.equal(s[1], "█"); // last value is the max
});

test("sparkline scales relative to the series max (steady positive series tops out)", () => {
  // No explicit max: the scale ceiling is the series max, so a constant positive
  // series renders all-full (each value IS the max). This is standard sparkline
  // behavior and what the live meter relies on to show recent *shape*.
  assert.equal(sparkline([5, 5, 5], { width: 3 }), "███");
});

test("sparkline renders an all-zero series as the empty glyph", () => {
  // Floor is 0, so silence (no throughput) is empty, not full.
  assert.equal(sparkline([0, 0, 0], { width: 3 }), "▁▁▁");
});

test("sparkline width 0 is empty", () => {
  assert.equal(sparkline([1, 2, 3], { width: 0 }), "");
});

test("bar fills proportionally", () => {
  assert.equal(bar(0.6, 10), "██████░░░░");
  assert.equal(bar(0, 5), "░░░░░");
  assert.equal(bar(1, 5), "█████");
  assert.equal(bar(2, 5), "█████"); // clamps
});

test("trimZero strips trailing decimal zeros", () => {
  assert.equal(trimZero("12.0"), "12");
  assert.equal(trimZero("1.20"), "1.2");
  assert.equal(trimZero("5"), "5");
  assert.equal(trimZero("100"), "100");
});
