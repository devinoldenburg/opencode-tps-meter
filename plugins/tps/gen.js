/**
 * gen.js — GenerationTimer: measures *active token-generation time* only.
 *
 * The whole point of a precise TPS meter is to report how fast the model emits
 * tokens, and NOTHING ELSE. A turn's wall-clock (`time.completed − time.created`,
 * or even `completed − firstToken`) includes everything OpenCode waits for inside
 * the turn: tool-call execution, permission prompts, provider stalls, the gap
 * before the model is re-invoked after a tool. Dividing tokens by that wall-clock
 * understates the true generation speed.
 *
 * Instead we time the stream itself. Each streamed token chunk arrives at a known
 * wall-clock instant. The model is "actively generating" during the small gaps
 * between consecutive chunks; a *large* gap means it stopped emitting (a tool
 * call, a wait, a stall). So active-generation time is the sum of inter-chunk
 * gaps that are below a threshold; gaps at/above the threshold are excluded as
 * "idle" (whatever OpenCode was waiting for).
 *
 *     activeMs = Σ gapᵢ           for gapᵢ <  gapThresholdMs
 *     idleMs   = Σ gapᵢ           for gapᵢ >= gapThresholdMs   (excluded)
 *     TPS      = decodeTokens / (activeMs / 1000)
 *
 * One subtlety makes it exact rather than ~1% high. The first chunk of a burst
 * (the very first chunk, and the first chunk after each excluded idle gap) was
 * decoded during the prefill/resume window *before* `firstAt`/before the model
 * resumed — that's time we deliberately don't count. So those "prime" tokens
 * belong to TTFT/resume, not to the active-decode window, and are excluded from
 * the numerator. With that, a constant-rate stream measures its true rate to the
 * token: `decodeTokens = tokens − primeTokens`.
 *
 * Active generation gaps are tiny (models emit many tokens/sec, and OpenCode
 * batches deltas — typically < ~500 ms apart). Tool calls / waits create
 * multi-second gaps. The default 1500 ms threshold sits comfortably between, so
 * real generation is never excluded and waits always are. It reads no wall clock
 * itself (the caller passes timestamps), so it is fully deterministic/testable.
 */

export const DEFAULT_GAP_THRESHOLD_MS = 1500;

export class GenerationTimer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.gapThresholdMs=1500] Inter-chunk gaps >= this are treated
   *   as idle (a tool call / wait) and excluded from active-generation time.
   */
  constructor(opts = {}) {
    const g = Number(opts.gapThresholdMs);
    this.gapThresholdMs = Number.isFinite(g) && g > 0 ? g : DEFAULT_GAP_THRESHOLD_MS;
    this.reset();
  }

  reset() {
    this._tokens = 0; // total tokens observed (estimate while streaming; exact set via setTokens)
    this._primeTokens = 0; // tokens of prefill/resume chunks (excluded from the decode numerator)
    this._activeMs = 0; // summed active-generation gaps
    this._idleMs = 0; // summed excluded gaps (tool/wait)
    this._gaps = 0; // count of excluded gaps
    this._firstAt = null; // first chunk arrival (for TTFT)
    this._lastAt = null; // most recent chunk arrival
    this._pendingPrime = false; // tokenless burst opener; next token inherits prime
  }

  /**
   * Record a streamed chunk of `tokens` tokens observed at time `t` (ms). The time
   * since the previous chunk is added to active-generation time, unless it's large
   * enough to be an idle gap (tool call / wait), in which case it's excluded. A
   * chunk that opens a burst (the first chunk, or the first after an excluded gap)
   * is a "prime" chunk: its tokens were decoded during prefill/resume, so they are
   * excluded from the decode numerator.
   */
  push(tokens, t) {
    const at = Number(t);
    const tok = Number(tokens);
    if (!Number.isFinite(at)) return this;
    if (this._lastAt !== null && at < this._lastAt) return this;
    let prime = false;
    if (this._lastAt === null) {
      prime = true; // very first chunk → prefill window
    } else {
      const gap = at - this._lastAt;
      if (gap > 0) {
        if (gap < this.gapThresholdMs) this._activeMs += gap;
        else {
          this._idleMs += gap;
          this._gaps += 1;
          prime = true; // first chunk after an idle gap → resume/prefill window
        }
      }
    }
    if (this._pendingPrime) prime = true;
    if (this._firstAt === null) this._firstAt = at;
    if (Number.isFinite(tok) && tok > 0) {
      this._tokens += tok;
      if (prime) this._primeTokens += tok;
      this._pendingPrime = false;
    } else if (prime) {
      this._pendingPrime = true;
    }
    this._lastAt = at;
    return this;
  }

  /**
   * Replace the running (estimated) token count with the exact provider figure
   * once the message completes. Active time and the prime-token offset are
   * unchanged — they were measured from the real stream — so `tps()` becomes
   * (exact − prime) ÷ measured active time.
   */
  setTokens(exact) {
    const n = Number(exact);
    if (Number.isFinite(n) && n >= 0) {
      const ratio = this._tokens > 0 ? this._primeTokens / this._tokens : 0;
      this._tokens = n;
      this._primeTokens = Math.min(n, n * ratio);
    }
    return this;
  }

  /** Active token-generation time in ms (tool calls / waits excluded). */
  get activeMs() {
    return this._activeMs;
  }

  /** Excluded idle time in ms (whatever OpenCode waited for mid-turn). */
  get idleMs() {
    return this._idleMs;
  }

  /** Number of excluded idle gaps (≈ tool calls / waits during the turn). */
  get gaps() {
    return this._gaps;
  }

  get tokens() {
    return this._tokens;
  }

  get firstAt() {
    return this._firstAt;
  }

  get lastAt() {
    return this._lastAt;
  }

  /** Tokens of prefill/resume ("prime") chunks, excluded from the decode numerator. */
  get primeTokens() {
    return this._primeTokens;
  }

  /** Tokens credited to the active-decode window (total minus prefill/resume chunks). */
  get decodeTokens() {
    return Math.max(0, this._tokens - this._primeTokens);
  }

  /**
   * Tokens per second over active-generation time only. Returns null until there
   * is a measurable active span (needs ≥ 2 chunks close enough together).
   */
  tps() {
    if (this._activeMs <= 0) return null;
    return this.decodeTokens / (this._activeMs / 1000);
  }

  /** Immutable snapshot for the view/aggregate layers. */
  snapshot() {
    return {
      tokens: this._tokens,
      primeTokens: this._primeTokens,
      decodeTokens: this.decodeTokens,
      activeMs: this._activeMs,
      idleMs: this._idleMs,
      gaps: this._gaps,
      firstAt: this._firstAt,
      lastAt: this._lastAt,
      tps: this.tps(),
    };
  }
}

export default GenerationTimer;
