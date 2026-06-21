import { test } from "node:test";
import assert from "node:assert/strict";
import { RateMeter } from "../plugins/tps/meter.js";

test("empty meter reports zero and inactive", () => {
  const m = new RateMeter();
  assert.equal(m.rate(0), 0);
  assert.equal(m.rate(5000), 0);
  assert.equal(m.smooth(0), 0);
  assert.equal(m.active(0), false);
  assert.equal(m.total, 0);
  assert.equal(m.count, 0);
});

test("single delta: windowed rate before it ages out, zero after", () => {
  const m = new RateMeter({ windowMs: 3000 });
  m.push(100, 0);
  // at t=1000, full 100 tokens are inside the window, span = 1000ms
  assert.equal(m.rate(1000), 100);
  // at t=2000, span = 2000ms
  assert.equal(m.rate(2000), 50);
  // at t=4000 the sample (t=0) has aged out of the 3s window -> 0
  assert.equal(m.rate(4000), 0);
});

test("steady stream converges to the true rate", () => {
  const m = new RateMeter({ windowMs: 3000 });
  for (let t = 0; t <= 3000; t += 100) m.push(10, t); // 10 tok every 100ms = 100 tok/s
  // at now=3000 the t=0 sample drops; 30 samples * 10 = 300 tok over a 3s window
  assert.equal(m.rate(3000), 100);
});

test("multiple deltas use their actual span for peak precision", () => {
  const m = new RateMeter({ windowMs: 3000, minSpanMs: 250 });
  m.push(100, 0);
  m.push(100, 10);
  assert.equal(m.rate(10), 20000);
});

test("windowed rate decays monotonically when the stream stops", () => {
  const m = new RateMeter({ windowMs: 3000 });
  m.push(60, 0);
  const r1500 = m.rate(1500); // 60 / 1.5 = 40
  const r2500 = m.rate(2500); // 60 / 2.5 = 24
  assert.equal(r1500, 40);
  assert.equal(r2500, 24);
  assert.ok(r2500 < r1500);
  assert.equal(m.rate(3500), 0); // aged out
});

test("active() tracks the trailing window boundary", () => {
  const m = new RateMeter({ windowMs: 3000 });
  m.push(10, 1000);
  assert.equal(m.active(1000), true);
  assert.equal(m.active(4000), false); // exactly windowMs later is outside the window
  assert.equal(m.active(4001), false);
});

test("smooth() seeds from the first measurable instantaneous rate", () => {
  const m = new RateMeter({ halfLifeMs: 900 });
  m.push(100, 0);
  m.push(100, 100);
  assert.equal(m.smooth(100), 1000);
});

test("ignored zero deltas still refresh active state", () => {
  const m = new RateMeter({ windowMs: 3000 });
  m.push(10, 0);
  m.push(0, 2500);
  assert.equal(m.active(3000), true);
});

test("non-monotonic deltas are ignored", () => {
  const m = new RateMeter();
  m.push(10, 1000).push(10, 900).push(10, 1100);
  assert.equal(m.total, 20);
});

test("sample() builds a capped series and tracks the peak", () => {
  const m = new RateMeter({ windowMs: 3000, seriesLength: 4 });
  for (let t = 0; t <= 1000; t += 100) m.push(20, t);
  for (let t = 0; t <= 2000; t += 100) m.sample(t);
  assert.equal(m.series().length, 4); // capped
  assert.ok(m.peak > 0);
  // peak must be >= every sampled value
  for (const v of m.series()) assert.ok(v <= m.peak + 1e-9);
});

test("smooth() relaxes toward zero after the last token", () => {
  const m = new RateMeter({ halfLifeMs: 500 });
  for (let t = 0; t <= 2000; t += 100) m.push(10, t);
  const atLast = m.smooth(2000);
  const later = m.smooth(2000 + 5000); // 10 half-lives later
  assert.ok(atLast > 0);
  assert.ok(later < atLast);
  assert.ok(later < atLast * 0.01);
});

test("reset() clears all state", () => {
  const m = new RateMeter();
  m.push(50, 0);
  m.sample(100);
  m.reset();
  assert.equal(m.total, 0);
  assert.equal(m.count, 0);
  assert.equal(m.peak, 0);
  assert.equal(m.series().length, 0);
  assert.equal(m.rate(100), 0);
});

test("ignores non-positive and non-finite deltas", () => {
  const m = new RateMeter();
  m.push(0, 100);
  m.push(-5, 200);
  m.push(NaN, 300);
  m.push("x", 400);
  assert.equal(m.total, 0);
  assert.equal(m.count, 0);
});

test("snapshot exposes a coherent immutable view", () => {
  const m = new RateMeter({ windowMs: 3000 });
  for (let t = 0; t <= 1000; t += 100) m.push(10, t);
  m.sample(1000);
  const snap = m.snapshot(1000);
  assert.equal(typeof snap.rate, "number");
  assert.equal(snap.active, true);
  assert.ok(Array.isArray(snap.series));
  assert.ok(snap.total > 0);
  assert.ok(snap.elapsedSec >= 0);
});
