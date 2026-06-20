/**
 * view.js — pure projection from measurements to render-ready lines.
 *
 * The TUI plugin (tps-meter.tsx) stays deliberately thin: it gathers inputs
 * (a live RateMeter snapshot, the exact stats for the last/active message, the
 * session aggregate, and the session status) and hands them here. `buildView`
 * returns a list of `lines`, each a list of `{ text, tone }` segments. `tone` is
 * a *semantic* color name; the plugin maps tones → theme colors. Keeping this
 * pure means the entire sidebar layout is asserted in unit tests, character for
 * character, with no terminal involved.
 *
 * Tones: "header" | "accent" | "value" | "good" | "warn" | "muted" | "label".
 */

import { fmtRate, fmtTokens, fmtMs, fmtCost, sparkline } from "./format.js";

const DEFAULTS = {
  icon: "⚡",
  label: "TPS",
  unit: "tok/s",
  detail: "full", // "full" | "compact" | "minimal"
  metric: "output", // "output" | "generated" — which TPS to headline
  sparkWidth: 24,
  showCost: true,
  showCache: false,
  showSession: true,
  showSparkline: true,
};

/**
 * @param {object} input
 * @param {object|null} input.live      RateMeter snapshot (meter.snapshot(now)) or null.
 * @param {object|null} input.last      messageStats() for the most-recent message, or null.
 * @param {object|null} input.session   aggregate() over the session, or null.
 * @param {string} [input.status]       "busy" | "idle" | "retry" | undefined.
 * @param {object} [input.config]       Display config (see DEFAULTS).
 * @returns {{state:string, lines:Array<{key:string, segments:Array<{text:string,tone:string}>}>}}
 */
export function buildView(input = {}) {
  const cfg = { ...DEFAULTS, ...(input.config || {}) };
  const live = input.live || null;
  const last = input.last || null;
  const session = input.session || null;
  const status = input.status;

  const streaming = !!(live && live.active) || status === "busy";
  const hasHistory = !!last || (session && session.count > 0);

  if (!streaming && !hasHistory) {
    return { state: "none", lines: [] };
  }

  const metricKey = cfg.metric === "generated" ? "generatedTps" : "outputTps";
  const headline = streaming
    ? (live ? live.rate : null)
    : last
      ? last[metricKey]
      : null;

  const lines = [];
  const push = (key, segments) => lines.push({ key, segments: segments.filter((s) => s && s.text != null) });

  // ── Header + headline number ──────────────────────────────────────────────
  const headerSegs = [{ text: `${cfg.icon} ${cfg.label}`, tone: "header" }];
  if (headline !== null && headline !== undefined) {
    headerSegs.push({ text: "  ", tone: "muted" });
    headerSegs.push({ text: fmtRate(headline), tone: streaming ? "accent" : "value" });
    headerSegs.push({ text: ` ${cfg.unit}`, tone: "muted" });
    headerSegs.push({ text: streaming ? "  ●live" : "  last", tone: streaming ? "good" : "muted" });
  }
  push("header", headerSegs);

  // ── Sparkline of recent live rates ────────────────────────────────────────
  if (cfg.showSparkline && live && Array.isArray(live.series) && live.series.length) {
    const spark = sparkline(live.series, { width: cfg.sparkWidth });
    push("spark", [{ text: spark, tone: streaming ? "accent" : "muted" }]);
  }

  if (cfg.detail === "minimal") return { state: streaming ? "live" : "idle", lines };

  // ── Last message: exact, provider-reported throughput ─────────────────────
  if (last && last.done) {
    const detail = [];
    if (last.ttftMs !== null && last.ttftMs !== undefined) {
      detail.push(`ttft ${fmtMs(last.ttftMs)}`);
    }
    detail.push(`${fmtTokens(last.output)} tok`);
    if (last.decodeMs) detail.push(fmtMs(last.decodeMs));
    push("last", [
      { text: "last ", tone: "label" },
      { text: `${fmtRate(last[metricKey])} ${cfg.unit}`, tone: "value" },
      { text: `  ${detail.join(" · ")}`, tone: "muted" },
    ]);
  } else if (streaming && live) {
    // Active message not yet finalized: show what we can measure live.
    const bits = [`${fmtTokens(Math.round(live.total))} tok`];
    if (live.peak) bits.push(`peak ${fmtRate(live.peak)}`);
    push("live-detail", [
      { text: "now  ", tone: "label" },
      { text: bits.join(" · "), tone: "muted" },
    ]);
  }

  // ── Session aggregate ─────────────────────────────────────────────────────
  if (cfg.showSession && session && session.count > 0) {
    push("avg", [
      { text: "avg  ", tone: "label" },
      { text: `${fmtRate(session[cfg.metric === "generated" ? "avgGeneratedTps" : "avgOutputTps"])} ${cfg.unit}`, tone: "value" },
      { text: session.peakTps ? `  peak ${fmtRate(session.peakTps)}` : "", tone: "muted" },
    ]);

    const totals = [`${fmtTokens(session.output)} tok`, `${session.count} msg`];
    if (cfg.showCache && (session.cacheRead || session.cacheWrite)) {
      totals.push(`cache ${fmtTokens(session.cacheRead)}r`);
    }
    if (cfg.showCost) totals.push(fmtCost(session.cost));
    push("totals", [
      { text: "Σ    ", tone: "label" },
      { text: totals.join(" · "), tone: "muted" },
    ]);
  }

  return { state: streaming ? "live" : "idle", lines };
}

/** Flatten a view's lines into plain strings (used by the demo + tests). */
export function renderText(view) {
  if (!view || !Array.isArray(view.lines)) return "";
  return view.lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
}

export { DEFAULTS as VIEW_DEFAULTS };
