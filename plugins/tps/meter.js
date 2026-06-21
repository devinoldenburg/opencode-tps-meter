/**
 * RateMeter — a precise, real-time tokens-per-second estimator.
 *
 * It is fed timestamped token deltas (`push(tokens, t)`) as they stream in, and
 * reports throughput two ways:
 *
 *   - `rate(now)`   trailing **windowed** average: tokens observed in the last
 *                   `windowMs` divided by the actual elapsed window duration.
 *                   This is the headline "live TPS". It is unbiased once the
 *                   stream has run for `windowMs`, responsive before then, and
 *                   decays smoothly to 0 over `windowMs` once the stream stops
 *                   (because `now` keeps advancing while no new tokens arrive).
 *
 *   - `smooth(now)` continuous-time EWMA of the instantaneous inter-arrival
 *                   rate, weighted by elapsed time (`halfLifeMs`). Smoother /
 *                   less jittery; used for a steadier headline if preferred.
 *
 * Everything is integer/float arithmetic over millisecond timestamps — no wall
 * clock is read inside the meter, so it is fully deterministic and unit-testable:
 * the caller supplies `now`/`t` (real code passes `Date.now()`; tests pass fixed
 * values).
 */

const LN2 = Math.log(2);

export class RateMeter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.windowMs=3000]   Trailing window for `rate()`.
   * @param {number} [opts.minSpanMs=250]   Floor on the window span, so the first
   *   few deltas can't report an absurd spike (rate <= total / minSpanMs).
   * @param {number} [opts.seriesLength=40]  Sparkline ring-buffer length.
   * @param {number} [opts.halfLifeMs=900]   EWMA half-life for `smooth()`.
   */
  constructor(opts = {}) {
    this.windowMs = positive(opts.windowMs, 3000);
    this.minSpanMs = positive(opts.minSpanMs, 250);
    this.seriesLength = Math.max(1, Math.floor(positive(opts.seriesLength, 40)));
    this.halfLifeMs = positive(opts.halfLifeMs, 900);
    this.reset();
  }

  reset() {
    /** @type {{t:number, tok:number}[]} ascending by t */
    this._samples = [];
    this._windowSum = 0; // running sum of tok for samples currently in _samples
    this._total = 0; // all tokens ever pushed
    this._count = 0; // number of deltas pushed
    this._startedAt = null;
    this._lastAt = null;
    this._prevAt = null;
    this._ewma = null;
    this._peak = 0;
    this._series = [];
    this._head = 0;
  }

  /**
   * Record `tokens` tokens observed at time `t` (ms). Non-finite or non-positive
   * token counts are ignored (a zero-length delta carries no throughput signal),
   * but a later timestamp still advances `lastAt` via `sample()`/`rate()`.
   */
  push(tokens, t) {
    const tok = Number(tokens);
    const at = Number(t);
    if (!Number.isFinite(at)) return this;
    if (this._lastAt !== null && at < this._lastAt) return this;
    if (!Number.isFinite(tok) || tok <= 0) {
      this._lastAt = at;
      return this;
    }
    if (this._startedAt === null) this._startedAt = at;
    // Continuous-time EWMA of the instantaneous gap rate.
    if (this._prevAt !== null && at > this._prevAt) {
      const dt = at - this._prevAt;
      const inst = tok / (dt / 1000);
      if (this._ewma === null) this._ewma = inst;
      else {
        const alpha = 1 - Math.exp((-dt / this.halfLifeMs) * LN2);
        this._ewma = this._ewma + alpha * (inst - this._ewma);
      }
    }
    this._samples.push({ t: at, tok });
    this._windowSum += tok;
    this._total += tok;
    this._count += 1;
    this._prevAt = at;
    this._lastAt = at;
    this._prune(at);
    return this;
  }

  /** Drop samples that have fallen outside the trailing window ending at `now`. */
  _prune(now) {
    const left = now - this.windowMs;
    const s = this._samples;
    while (this._head < s.length && s[this._head].t <= left) {
      this._windowSum -= s[this._head].tok;
      this._head++;
    }
    if (this._head > 64 && this._head * 2 > s.length) {
      s.splice(0, this._head);
      this._head = 0;
    }
    if (this._windowSum < -1e-9) throw new Error("RateMeter window sum invariant violated");
    if (this._windowSum < 0) this._windowSum = 0; // tolerate tiny fp drift
  }

  /**
   * Trailing windowed throughput (tokens/sec) at time `now`. Returns 0 before any
   * tokens, or once the stream has been silent for longer than `windowMs`.
   */
  rate(now) {
    const at = Number(now);
    if (!Number.isFinite(at) || this._startedAt === null) return 0;
    this._prune(at);
    if (this._windowSum <= 0) return 0;
    const left = Math.max(at - this.windowMs, this._startedAt);
    const rawSpan = at - left;
    const span = this._samples.length - this._head > 1 ? Math.max(rawSpan, 1) : Math.max(rawSpan, this.minSpanMs);
    return this._windowSum / (span / 1000);
  }

  /** EWMA-smoothed throughput (tokens/sec). Decays toward 0 as `now` advances past the last token. */
  smooth(now) {
    if (this._ewma === null) return 0;
    const at = Number(now);
    if (Number.isFinite(at) && this._lastAt !== null && at > this._lastAt) {
      // Decay the held EWMA for the idle gap since the last token so a stalled
      // stream relaxes toward 0 instead of freezing at its last value.
      const dt = at - this._lastAt;
      const decay = Math.exp((-dt / this.halfLifeMs) * LN2);
      return this._ewma * decay;
    }
    return this._ewma;
  }

  /**
   * Compute `rate(now)`, append it to the sparkline series, and update the peak.
   * Returns the windowed rate. Call this once per render tick.
   */
  sample(now) {
    const r = this.rate(now);
    if (r > this._peak) this._peak = r;
    this._series.push(r);
    if (this._series.length > this.seriesLength) {
      this._series.splice(0, this._series.length - this.seriesLength);
    }
    return r;
  }

  /** True if a token arrived within `windowMs` of `now` (i.e. actively streaming). */
  active(now) {
    if (this._lastAt === null) return false;
    const at = Number(now);
    if (!Number.isFinite(at)) return false;
    return at - this._lastAt < this.windowMs;
  }

  series() {
    return this._series.slice();
  }

  get peak() {
    return this._peak;
  }

  get total() {
    return this._total;
  }

  get count() {
    return this._count;
  }

  get startedAt() {
    return this._startedAt;
  }

  get lastAt() {
    return this._lastAt;
  }

  /** Wall-clock seconds between the first and last observed token (0 if <2 tokens). */
  elapsedSec() {
    if (this._startedAt === null || this._lastAt === null) return 0;
    return Math.max(0, (this._lastAt - this._startedAt) / 1000);
  }

  /** A single immutable snapshot for the view layer. */
  snapshot(now) {
    return {
      rate: this.rate(now),
      smooth: this.smooth(now),
      peak: this._peak,
      total: this._total,
      count: this._count,
      active: this.active(now),
      series: this.series(),
      elapsedSec: this.elapsedSec(),
    };
  }
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default RateMeter;
