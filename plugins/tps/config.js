/**
 * config.js — pure resolution of plugin options + env overrides into a frozen
 * runtime config. Kept out of the TSX so it can be unit-tested under node.
 */

/** Semantic tone → theme color key (TuiThemeCurrent). Overridable via options.colors. */
export const TONE_TO_THEME = {
  header: "text",
  accent: "accent",
  value: "text",
  good: "success",
  warn: "warning",
  muted: "textMuted",
  label: "textMuted",
};

export const DEFAULTS = {
  enabled: true,
  order: 150, // just after the native Context/usage section (order 100)
  slot: "sidebar_content", // stacking slot — additive, never replaces native content
  pollMs: 250, // live re-sample cadence (sparkline animation + decay)
  windowMs: 3000, // trailing window for the live sparkline rate
  gapMs: 1500, // inter-token gap at/above which generation is "paused" (tool/wait) and excluded
  seriesLength: 40, // sparkline history length
  metric: "generated", // "generated" (output+reasoning) | "output"
  detail: "full", // "full" | "compact" | "minimal"
  icon: "", // optional prefix glyph; empty = none (clean/professional default)
  label: "TPS",
  unit: "tok/s",
  sparkWidth: 24,
  showSparkline: true,
  showSession: true,
  showWaits: true, // surface excluded tool/wait time (precision signal)
  // OpenCode's native Context section already shows tokens / context% / cost, so
  // these are OFF by default to avoid duplicating native stats.
  showTotals: false,
  showCost: false,
  showCache: false,
  colors: null, // optional { tone: hexString }
};

const DETAILS = ["full", "compact", "minimal"];

export function isFalsy(v) {
  return v === false || v === 0 || v === "0" || v === "false" || v === "off" || v === "no";
}

function num(value, fallback, min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return min !== undefined ? Math.max(min, n) : n;
}

/**
 * @param {object} [options]  Plugin options (the `[name, options]` tuple value).
 * @param {object} [env]      process.env (for env overrides).
 * @returns {object}          Resolved config (see DEFAULTS for the shape).
 */
export function resolveConfig(options, env) {
  const o = options && typeof options === "object" ? options : {};
  const e = env || {};
  const disabled =
    o.enabled === false ||
    isFalsy(e.OPENCODE_TPS_METER) ||
    e.OPENCODE_TPS_METER_DISABLE === "1" ||
    e.OPENCODE_TPS_METER_DISABLE === "true";

  // "output" only if explicitly requested; default (and anything else) → generated.
  const metric =
    o.metric === "output" || e.OPENCODE_TPS_METER_METRIC === "output" ? "output" : "generated";
  const detailRaw = o.detail || e.OPENCODE_TPS_METER_DETAIL || DEFAULTS.detail;
  const detail = DETAILS.includes(detailRaw) ? detailRaw : DEFAULTS.detail;

  return {
    enabled: !disabled,
    order: num(o.order, DEFAULTS.order),
    slot: typeof o.slot === "string" && o.slot ? o.slot : e.OPENCODE_TPS_METER_SLOT || DEFAULTS.slot,
    pollMs: num(o.pollMs, DEFAULTS.pollMs, 50),
    windowMs: num(o.windowMs ?? e.OPENCODE_TPS_METER_WINDOW_MS, DEFAULTS.windowMs, 250),
    gapMs: num(o.gapMs ?? e.OPENCODE_TPS_METER_GAP_MS, DEFAULTS.gapMs, 100),
    seriesLength: Math.floor(num(o.seriesLength, DEFAULTS.seriesLength, 1)),
    metric,
    detail,
    icon: typeof o.icon === "string" ? o.icon : DEFAULTS.icon,
    label: typeof o.label === "string" ? o.label : DEFAULTS.label,
    unit: typeof o.unit === "string" ? o.unit : DEFAULTS.unit,
    sparkWidth: Math.floor(num(o.sparkWidth, DEFAULTS.sparkWidth, 0)),
    showSparkline: o.showSparkline !== false,
    showSession: o.showSession !== false,
    showWaits: o.showWaits !== false,
    showTotals: o.showTotals === true,
    showCost: o.showCost === true,
    showCache: o.showCache === true,
    colors: o.colors && typeof o.colors === "object" ? o.colors : null,
  };
}
