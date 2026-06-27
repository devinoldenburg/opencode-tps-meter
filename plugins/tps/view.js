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
import { DEFAULTS } from "./config.js";

const HEAD_PAD = "  ";

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
  const push = (key, segments) => lines.push({ key, segments: segments.filter((s) => s && s.text != null && s.text !== "") });

  const headerLabel = cfg.icon ? `${cfg.icon} ${cfg.label}` : cfg.label;
  const headerSegs = [{ text: headerLabel, tone: "header" }];
  if (headline !== null && headline !== undefined) {
    headerSegs.push({ text: HEAD_PAD, tone: "muted" });
    headerSegs.push({ text: fmtRate(headline), tone: streaming ? "accent" : "value" });
    headerSegs.push({ text: ` ${cfg.unit}`, tone: "muted" });
  }
  push("header", headerSegs);

  const showSpark =
    cfg.showSparkline && live && Array.isArray(live.series) && live.series.length && (cfg.detail !== "compact" || streaming);
  if (showSpark) {
    push("spark", [{ text: sparkline(live.series, { width: cfg.sparkWidth }), tone: streaming ? "accent" : "muted" }]);
  }

  if (cfg.detail === "minimal") return { state: streaming ? "live" : "idle", lines };

  if (cfg.detail === "compact") {
    pushCompactFooter({ push, cfg, streaming, live, last, session, metricKey, avgKey, headline });
    return { state: streaming ? "live" : "idle", lines };
  }

  // ── full detail ───────────────────────────────────────────────────────────
  if (last && last.done) {
    const detail = [];
    if (last.ttftMs !== null && last.ttftMs !== undefined) detail.push(`ttft ${fmtMs(last.ttftMs)}`);
    if (cfg.showWaits && last.gaps > 0 && last.idleMs > 0) detail.push(`−${fmtMs(last.idleMs)} wait`);
    push("last", [
      { text: "last ", tone: "label" },
      { text: `${fmtRate(last[metricKey])} ${cfg.unit}`, tone: "value" },
      { text: detail.length ? `  ${detail.join(" · ")}` : "", tone: "muted" },
    ]);
  }
  if (streaming && live) {
    const bits = [];
    if (live.peak) bits.push(`peak ${fmtRate(live.peak)} ${cfg.unit}`);
    if (cfg.showWaits && live.gaps > 0 && live.idleMs > 0) bits.push(`−${fmtMs(live.idleMs)} wait`);
    if (bits.length) push("live-detail", [{ text: "now  ", tone: "label" }, { text: bits.join(" · "), tone: "muted" }]);
  }

  if (cfg.showSession && session && session.count > 0) {
    push("avg", [
      { text: "avg  ", tone: "label" },
      { text: `${fmtRate(session[avgKey])} ${cfg.unit}`, tone: "value" },
      { text: session.peakTps ? `  peak ${fmtRate(session.peakTps)}` : "", tone: "muted" },
    ]);

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

/**
 * One muted footer line: timing + session stats without repeating the headline.
 */
function pushCompactFooter({ push, cfg, streaming, live, last, session, metricKey, avgKey, headline }) {
  const parts = [];

  if (streaming && live) {
    if (live.peak && (!Number.isFinite(headline) || Math.abs(live.peak - headline) > 0.05)) {
      parts.push(`peak ${fmtRate(live.peak)}`);
    }
    if (cfg.showWaits && live.gaps > 0 && live.idleMs > 0) parts.push(`−${fmtMs(live.idleMs)} wait`);
  } else if (last && last.done) {
    if (last.ttftMs !== null && last.ttftMs !== undefined) parts.push(`ttft ${fmtMs(last.ttftMs)}`);
    if (cfg.showWaits && last.gaps > 0 && last.idleMs > 0) parts.push(`−${fmtMs(last.idleMs)} wait`);
  }

  if (cfg.showSession && session && session.count > 0) {
    const avg = session[avgKey];
    const sameAsHead =
      headline !== null && headline !== undefined && avg !== null && avg !== undefined && Math.abs(avg - headline) < 0.05;
    if (avg !== null && avg !== undefined && !sameAsHead) parts.push(`avg ${fmtRate(avg)}`);
    if (session.peakTps) {
      const samePeak =
        headline !== null && headline !== undefined && Math.abs(session.peakTps - headline) < 0.05;
      if (!samePeak) parts.push(`peak ${fmtRate(session.peakTps)}`);
    }
  }

  if (parts.length) {
    push("footer", [{ text: parts.join(" · "), tone: "muted" }]);
  }
}

/** Flatten a view's lines into plain strings (used by the demo + tests). */
export function renderText(view) {
  if (!view || !Array.isArray(view.lines)) return "";
  return view.lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
}

export { DEFAULTS as VIEW_DEFAULTS };