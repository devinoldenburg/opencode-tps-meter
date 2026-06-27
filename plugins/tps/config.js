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
  detail: "compact", // "full" | "compact" | "minimal"
  icon: "", // optional prefix glyph; empty = none (clean/professional default)
  label: "TPS",
  unit: "tok/s",
  sparkWidth: 18,
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
const MIN_ORDER = 0;
const MIN_POLL_MS = 50;
const MIN_WINDOW_MS = 250;
const MIN_GAP_MS = 100;
const MIN_SERIES_LENGTH = 1;
const MIN_SPARK_WIDTH = 0;

export function isFalsy(v) {
  return v === false || v === 0 || v === "" || v === "0" || v === "false" || v === "off" || v === "no";
}

function isTruthy(v) {
  return v === true || v === 1 || v === "1" || v === "true" || v === "on" || v === "yes";
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
    o.enabled !== true &&
    (o.enabled === false || isFalsy(e.OPENCODE_TPS_METER) || isTruthy(e.OPENCODE_TPS_METER_DISABLE));

  // "output" only if explicitly requested; default (and anything else) → generated.
  const metricRaw = e.OPENCODE_TPS_METER_METRIC ?? o.metric;
  const metric = metricRaw === "output" ? "output" : "generated";
  const detailRaw = o.detail || e.OPENCODE_TPS_METER_DETAIL || DEFAULTS.detail;
  const detail = DETAILS.includes(detailRaw) ? detailRaw : DEFAULTS.detail;

  return {
    enabled: !disabled,
    order: num(o.order, DEFAULTS.order, MIN_ORDER),
    slot: typeof o.slot === "string" && o.slot ? o.slot : e.OPENCODE_TPS_METER_SLOT || DEFAULTS.slot,
    pollMs: num(o.pollMs ?? e.OPENCODE_TPS_METER_POLL_MS, DEFAULTS.pollMs, MIN_POLL_MS),
    windowMs: num(o.windowMs ?? e.OPENCODE_TPS_METER_WINDOW_MS, DEFAULTS.windowMs, MIN_WINDOW_MS),
    gapMs: num(o.gapMs ?? e.OPENCODE_TPS_METER_GAP_MS, DEFAULTS.gapMs, MIN_GAP_MS),
    seriesLength: Math.floor(num(o.seriesLength ?? e.OPENCODE_TPS_METER_SERIES_LENGTH, DEFAULTS.seriesLength, MIN_SERIES_LENGTH)),
    metric,
    detail,
    icon: typeof o.icon === "string" ? o.icon : DEFAULTS.icon,
    label: typeof o.label === "string" ? o.label : DEFAULTS.label,
    unit: typeof o.unit === "string" ? o.unit : DEFAULTS.unit,
    sparkWidth: Math.floor(num(o.sparkWidth ?? e.OPENCODE_TPS_METER_SPARK_WIDTH, DEFAULTS.sparkWidth, MIN_SPARK_WIDTH)),
    showSparkline: bool(o.showSparkline, e.OPENCODE_TPS_METER_SHOW_SPARKLINE, DEFAULTS.showSparkline),
    showSession: bool(o.showSession, e.OPENCODE_TPS_METER_SHOW_SESSION, DEFAULTS.showSession),
    showWaits: bool(o.showWaits, e.OPENCODE_TPS_METER_SHOW_WAITS, DEFAULTS.showWaits),
    showTotals: bool(o.showTotals, e.OPENCODE_TPS_METER_SHOW_TOTALS, DEFAULTS.showTotals),
    showCost: bool(o.showCost, e.OPENCODE_TPS_METER_SHOW_COST, DEFAULTS.showCost),
    showCache: bool(o.showCache, e.OPENCODE_TPS_METER_SHOW_CACHE, DEFAULTS.showCache),
    colors: o.colors && typeof o.colors === "object" ? o.colors : null,
  };
}

function bool(option, envValue, fallback) {
  if (option !== undefined) return !isFalsy(option);
  if (envValue !== undefined) return !isFalsy(envValue);
  return fallback;
}
