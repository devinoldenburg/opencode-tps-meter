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
  icon: "",
  label: "TPS",
  unit: "tok/s",
  detail: "full", // "full" | "compact" | "minimal"
  metric: "generated", // "generated" (output+reasoning) | "output" — which TPS to headline
  sparkWidth: 24,
  showSparkline: true,
  showSession: true,
  showWaits: true, // surface the excluded tool/wait time as a precision signal
  // OpenCode's native Context section already shows total tokens, % context, and
  // cost — so those are OFF by default here to avoid duplicating native stats.
  showTotals: false,
  showCost: false,
  showCache: false,
};

/**
 * @param {object} input
 * @param {object|null} input.live      Live snapshot `{ tps, active, series, peak, gaps?, idleMs? }` or null.
 * @param {object|null} input.last      messageStats() for the most-recent completed message, or null.
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

  // "Streaming" = the model is producing tokens *right now*. The session status
  // is authoritative (it flips to "idle" the moment a turn completes), so trust
  // it when present; the meter's trailing window is only a fallback for runtimes
  // that don't surface status. This keeps a completed message from showing a
  // stale live rate while its rate window drains (the headline snaps to the exact
  // figure instead).
  const streaming =
    status === "busy" ? true : status === "idle" || status === "retry" ? false : !!(live && live.active);
  const hasHistory = !!last || (session && session.count > 0);

  if (!streaming && !hasHistory) {
    return { state: "none", lines: [] };
  }

  const metricKey = cfg.metric === "output" ? "outputTps" : "generatedTps";
  const avgKey = cfg.metric === "output" ? "avgOutputTps" : "avgGeneratedTps";
  const headline = streaming ? (live ? live.tps : null) : last ? last[metricKey] : null;

  const lines = [];
  const push = (key, segments) => lines.push({ key, segments: segments.filter((s) => s && s.text != null) });

  // ── Header + headline number (active-generation TPS) ──────────────────────
  const headerLabel = cfg.icon ? `${cfg.icon} ${cfg.label}` : cfg.label;
  const headerSegs = [{ text: headerLabel, tone: "header" }];
  if (headline !== null && headline !== undefined) {
    headerSegs.push({ text: "  ", tone: "muted" });
    headerSegs.push({ text: fmtRate(headline), tone: streaming ? "accent" : "value" });
    headerSegs.push({ text: ` ${cfg.unit}`, tone: "muted" });
  }
  push("header", headerSegs);

  // ── Sparkline of recent live rates ────────────────────────────────────────
  if (cfg.showSparkline && live && Array.isArray(live.series) && live.series.length) {
    push("spark", [{ text: sparkline(live.series, { width: cfg.sparkWidth }), tone: streaming ? "accent" : "muted" }]);
  }

  if (cfg.detail === "minimal") return { state: streaming ? "live" : "idle", lines };

  // ── Last message: exact generation rate, TTFT, and excluded wait ──────────
  if (last && last.done) {
    const detail = [];
    if (last.ttftMs !== null && last.ttftMs !== undefined) detail.push(`ttft ${fmtMs(last.ttftMs)}`);
    if (cfg.showWaits && last.gaps > 0 && last.idleMs > 0) detail.push(`−${fmtMs(last.idleMs)} wait`);
    push("last", [
      { text: "last ", tone: "label" },
      { text: `${fmtRate(last[metricKey])} ${cfg.unit}`, tone: "value" },
      { text: detail.length ? `  ${detail.join(" · ")}` : "", tone: "muted" },
    ]);
  } else if (streaming && live) {
    // Active message not yet finalized: peak so far + any wait already excluded.
    const bits = [];
    if (live.peak) bits.push(`peak ${fmtRate(live.peak)} ${cfg.unit}`);
    if (cfg.showWaits && live.gaps > 0 && live.idleMs > 0) bits.push(`−${fmtMs(live.idleMs)} wait`);
    if (bits.length) push("live-detail", [{ text: "now  ", tone: "label" }, { text: bits.join(" · "), tone: "muted" }]);
  }

  // ── Session aggregate: throughput only (totals/cost are native) ───────────
  if (cfg.showSession && session && session.count > 0) {
    push("avg", [
      { text: "avg  ", tone: "label" },
      { text: `${fmtRate(session[avgKey])} ${cfg.unit}`, tone: "value" },
      { text: session.peakTps ? `  peak ${fmtRate(session.peakTps)}` : "", tone: "muted" },
    ]);

    // Opt-in only — duplicates OpenCode's native Context section.
    if (cfg.showTotals) {
      const metricTokens = cfg.metric === "output" ? session.output : session.generated;
      const totals = [`${fmtTokens(metricTokens)} tok`, `${session.count} msg`];
      if (cfg.showCache && (session.cacheRead || session.cacheWrite)) totals.push(`cache ${fmtTokens(session.cacheRead)}r`);
      if (cfg.showCost) totals.push(fmtCost(session.cost));
      push("totals", [{ text: "Σ    ", tone: "label" }, { text: totals.join(" · "), tone: "muted" }]);
    }
  }

  return { state: streaming ? "live" : "idle", lines };
}

/** Flatten a view's lines into plain strings (used by the demo + tests). */
export function renderText(view) {
  if (!view || !Array.isArray(view.lines)) return "";
  return view.lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
}

export { DEFAULTS as VIEW_DEFAULTS };
