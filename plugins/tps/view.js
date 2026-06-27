/**
 * view.js — pure projection from measurements to render-ready lines.
 *
 * Compact layout follows native OpenCode sidebar rhythm: section title, primary
 * value, optional spark (while streaming), one muted detail line. Full layout
 * keeps labeled rows for power users.
 *
 * Tones: "header" | "accent" | "value" | "good" | "warn" | "muted" | "label".
 */

import { fmtRate, fmtTokens, fmtMs, fmtCost, sparkline } from "./format.js";
import { DEFAULTS } from "./config.js";

const FULL_HEAD_PAD = "  ";

/**
 * @param {object} input
 * @param {object|null} input.live
 * @param {object|null} input.last
 * @param {object|null} input.session
 * @param {string} [input.status]
 * @param {object} [input.config]
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
  const compact = cfg.detail === "compact";

  if (compact) {
    push("title", [{ text: headerLabel, tone: "header" }]);
    if (headline !== null && headline !== undefined) {
      push("rate", [
        { text: fmtRate(headline), tone: streaming ? "accent" : "value" },
        { text: ` ${cfg.unit}`, tone: "muted" },
      ]);
    }
  } else {
    const headerSegs = [{ text: headerLabel, tone: "header" }];
    if (headline !== null && headline !== undefined) {
      headerSegs.push({ text: FULL_HEAD_PAD, tone: "muted" });
      headerSegs.push({ text: fmtRate(headline), tone: streaming ? "accent" : "value" });
      headerSegs.push({ text: ` ${cfg.unit}`, tone: "muted" });
    }
    push("header", headerSegs);
  }

  const showSpark =
    cfg.showSparkline && live && Array.isArray(live.series) && live.series.length && (!compact || streaming);
  if (showSpark) {
    push("spark", [{ text: sparkline(live.series, { width: cfg.sparkWidth }), tone: "spark" }]);
  }

  if (cfg.detail === "minimal") return { state: streaming ? "live" : "idle", lines };

  if (compact) {
    pushCompactFooter({ push, cfg, streaming, live, last, session, metricKey, avgKey, headline });
    return { state: streaming ? "live" : "idle", lines };
  }

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

function pushCompactFooter({ push, cfg, streaming, live, last, session, metricKey, avgKey, headline }) {
  const parts = [];

  if (streaming && live) {
    if (live.peak && (!Number.isFinite(headline) || Math.abs(live.peak - headline) > 0.05)) {
      parts.push(`Peak ${fmtRate(live.peak)}`);
    }
    if (cfg.showWaits && live.gaps > 0 && live.idleMs > 0) parts.push(`Wait ${fmtMs(live.idleMs)}`);
  } else if (last && last.done) {
    if (last.ttftMs !== null && last.ttftMs !== undefined) parts.push(`TTFT ${fmtMs(last.ttftMs)}`);
    if (cfg.showWaits && last.gaps > 0 && last.idleMs > 0) parts.push(`Wait ${fmtMs(last.idleMs)}`);
  }

  if (cfg.showSession && session && session.count > 0) {
    const avg = session[avgKey];
    const sameAsHead =
      headline !== null && headline !== undefined && avg !== null && avg !== undefined && Math.abs(avg - headline) < 0.05;
    if (avg !== null && avg !== undefined && !sameAsHead) parts.push(`Avg ${fmtRate(avg)}`);
    if (session.peakTps) {
      const samePeak =
        headline !== null && headline !== undefined && Math.abs(session.peakTps - headline) < 0.05;
      if (!samePeak) parts.push(`Peak ${fmtRate(session.peakTps)}`);
    }
  }

  if (parts.length) {
    push("footer", [{ text: parts.join("  ·  "), tone: "muted" }]);
  }
}

/** Flatten a view's lines into plain strings (used by the demo + tests). */
export function renderText(view) {
  if (!view || !Array.isArray(view.lines)) return "";
  return view.lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");
}

export { DEFAULTS as VIEW_DEFAULTS };