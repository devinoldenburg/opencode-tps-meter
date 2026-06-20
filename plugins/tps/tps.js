/**
 * tps.js — authoritative, provider-reported throughput math.
 *
 * The RateMeter (meter.js) estimates *live* TPS from streamed text deltas. This
 * module computes the *exact* numbers OpenCode records once a message is known:
 * the provider-reported token counts and the server timestamps. These are the
 * ground truth the live meter is calibrated against.
 *
 * An OpenCode `AssistantMessage` carries:
 *   tokens: { input, output, reasoning, cache: { read, write } }
 *   time:   { created, completed? }   // epoch ms
 *   cost, modelID, providerID
 *
 * Definitions used here:
 *   - generated = output + reasoning   (every token the model actually decoded)
 *   - e2eMs     = completed - created  (includes prefill / time-to-first-token)
 *   - decodeMs  = completed - firstToken (decode only; needs a measured TTFT)
 *   - *Tps      = tokens / (seconds)
 *
 * We expose both end-to-end and decode-only rates because they answer different
 * questions: e2e is "how fast did the whole turn produce output" (what you feel),
 * decode is "how fast does the model emit tokens once it starts" (the model's raw
 * speed, independent of queueing / prefill latency).
 */

/** Default characters-per-token before any calibration (English-ish average). */
export const DEFAULT_CHARS_PER_TOKEN = 4;
const MIN_RATIO = 1.2;
const MAX_RATIO = 12;

/** Coerce to a finite number, else 0. */
function n0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce to a finite number, else null (used for optional timestamps). */
function nn(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** tokens/sec, or null when the duration is unknown / non-positive. */
export function rate(tokens, ms) {
  const t = Number(tokens);
  const d = Number(ms);
  if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return null;
  return t / (d / 1000);
}

/** Is this an assistant message with usage + timing we can measure? */
export function isAssistant(msg) {
  return !!msg && msg.role === "assistant" && !!msg.tokens && !!msg.time;
}

/**
 * Exact throughput stats for one assistant message.
 *
 * The decode window — the denominator of the TPS — is chosen by precision, best
 * first:
 *   1. "active"      measured active-generation time (a GenerationTimer's
 *                    `activeMs`): excludes prefill AND every mid-turn wait (tool
 *                    calls, permissions, stalls). This is the real generation TPS.
 *   2. "first-token" `completed − firstTokenAt`: excludes prefill only (still
 *                    includes tool/wait time inside the turn).
 *   3. "end-to-end"  `completed − created`: includes everything.
 *
 * @param {any} msg          OpenCode AssistantMessage.
 * @param {number|object} [timing]  Either a bare `firstTokenAt` (ms), or an object
 *   `{ firstTokenAt, activeMs, idleMs, gaps }` from the streaming GenerationTimer.
 * @returns {object|null}    Null if `msg` is not a usable assistant message.
 */
export function messageStats(msg, timing) {
  if (!isAssistant(msg)) return null;
  const created = nn(msg.time?.created);
  const completed = nn(msg.time?.completed);
  const output = n0(msg.tokens?.output);
  const reasoning = n0(msg.tokens?.reasoning);
  const input = n0(msg.tokens?.input);
  const cacheRead = n0(msg.tokens?.cache?.read);
  const cacheWrite = n0(msg.tokens?.cache?.write);
  const generated = output + reasoning;
  const done = completed !== null && created !== null && completed >= created;
  const e2eMs = done ? completed - created : null;

  let ft = null;
  let activeMs = null;
  let idleMs = 0;
  let gaps = 0;
  let primeTokens = 0;
  if (timing && typeof timing === "object") {
    ft = nn(timing.firstTokenAt);
    activeMs = nn(timing.activeMs);
    idleMs = n0(timing.idleMs);
    gaps = n0(timing.gaps);
    primeTokens = n0(timing.primeTokens);
  } else {
    ft = nn(timing);
  }

  const ttftMs = ft !== null && created !== null && ft >= created ? ft - created : null;

  let decodeMs;
  let decodeSource;
  if (activeMs !== null && activeMs > 0) {
    decodeMs = activeMs; // measured active generation time — the precise window
    decodeSource = "active";
  } else if (done && ft !== null && created !== null && ft >= created && completed >= ft) {
    decodeMs = completed - ft; // first-token window (excludes prefill only)
    decodeSource = "first-token";
  } else {
    decodeMs = e2eMs; // whole turn
    decodeSource = "end-to-end";
  }

  // On the measured-active window we also exclude the prefill/resume ("prime")
  // tokens from the numerator — they were decoded during the time we excluded — so
  // the rate matches the live GenerationTimer exactly. On the other windows the
  // first token's time IS in the denominator, so its tokens stay in the numerator.
  const onActive = decodeSource === "active";
  const decodeGenerated = onActive ? Math.max(0, generated - primeTokens) : generated;
  const decodeOutput = onActive ? Math.max(0, output - Math.min(primeTokens, output)) : output;

  return {
    id: msg.id,
    model: msg.modelID ?? null,
    provider: msg.providerID ?? null,
    output,
    reasoning,
    generated,
    input,
    cacheRead,
    cacheWrite,
    cost: n0(msg.cost),
    created,
    completed,
    done,
    ttftMs,
    e2eMs,
    decodeMs,
    activeMs,
    idleMs,
    gaps,
    primeTokens,
    decodeOutput,
    decodeGenerated,
    decodeSource,
    /** decode-window output TPS (prime-corrected on the active window). */
    outputTps: rate(decodeOutput, decodeMs),
    /** decode-window generated (output+reasoning) TPS (prime-corrected on the active window). */
    generatedTps: rate(decodeGenerated, decodeMs),
    /** strict end-to-end output TPS over created→completed. */
    e2eTps: rate(output, e2eMs),
    /** true unless the window is the whole turn (i.e. it excludes at least prefill). */
    decodeExcludesPrefill: decodeSource !== "end-to-end",
  };
}

/**
 * Aggregate exact stats across a session's completed messages. Averages are
 * pooled (sum tokens / sum time), NOT a mean of per-message rates — pooling is
 * the correct way to combine rates with different durations.
 *
 * @param {Array<object|null>} statList  Output of `messageStats` per message.
 */
export function aggregate(statList) {
  let count = 0;
  let output = 0;
  let reasoning = 0;
  let generated = 0;
  let decodeOutput = 0; // prime-corrected (matches the per-message decode numerators)
  let decodeGenerated = 0;
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let decodeMs = 0;
  let e2eMs = 0;
  let idleMs = 0;
  let gaps = 0;
  let peakTps = 0;
  let ttftSum = 0;
  let ttftCount = 0;

  for (const s of statList || []) {
    if (!s || !s.done) continue;
    count += 1;
    output += s.output;
    reasoning += s.reasoning;
    generated += s.generated;
    decodeOutput += s.decodeOutput ?? s.output;
    decodeGenerated += s.decodeGenerated ?? s.generated;
    input += s.input;
    cacheRead += s.cacheRead;
    cacheWrite += s.cacheWrite;
    cost += s.cost;
    if (s.decodeMs) decodeMs += s.decodeMs;
    if (s.e2eMs) e2eMs += s.e2eMs;
    if (s.idleMs) idleMs += s.idleMs;
    if (s.gaps) gaps += s.gaps;
    if (s.generatedTps && s.generatedTps > peakTps) peakTps = s.generatedTps;
    if (s.ttftMs !== null) {
      ttftSum += s.ttftMs;
      ttftCount += 1;
    }
  }

  return {
    count,
    output,
    reasoning,
    generated,
    input,
    cacheRead,
    cacheWrite,
    cost,
    decodeSec: decodeMs / 1000,
    e2eSec: e2eMs / 1000,
    idleSec: idleMs / 1000,
    gaps,
    avgOutputTps: rate(decodeOutput, decodeMs),
    avgGeneratedTps: rate(decodeGenerated, decodeMs),
    avgE2eTps: rate(output, e2eMs),
    peakTps: peakTps || null,
    avgTtftMs: ttftCount ? ttftSum / ttftCount : null,
  };
}

/**
 * EWMA-update a per-model characters-per-token ratio from one completed message,
 * where we know both the exact token count and the exact characters streamed.
 * Clamped to a sane range so a pathological message can't poison the estimate.
 *
 * @param {number|null|undefined} prev  Previous ratio (null/undefined → seed).
 * @param {number} chars                Characters streamed for the message.
 * @param {number} tokens              Exact tokens the chars correspond to.
 * @param {number} [alpha=0.3]          EWMA weight for the new sample.
 */
export function calibrateRatio(prev, chars, tokens, alpha = 0.3) {
  const c = Number(chars);
  const t = Number(tokens);
  const base = Number.isFinite(Number(prev)) && Number(prev) > 0 ? Number(prev) : null;
  if (!Number.isFinite(c) || !Number.isFinite(t) || c <= 0 || t <= 0) {
    return base ?? DEFAULT_CHARS_PER_TOKEN;
  }
  const sample = clampRatio(c / t);
  if (base === null) return sample;
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0.3;
  return clampRatio(base * (1 - a) + sample * a);
}

/** Estimate tokens from a character count using a (possibly calibrated) ratio. */
export function tokensFromChars(chars, ratio) {
  const c = Number(chars);
  const r = Number.isFinite(Number(ratio)) && Number(ratio) > 0 ? Number(ratio) : DEFAULT_CHARS_PER_TOKEN;
  if (!Number.isFinite(c) || c <= 0) return 0;
  return c / r;
}

function clampRatio(r) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}
