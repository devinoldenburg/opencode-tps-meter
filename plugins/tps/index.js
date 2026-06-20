/**
 * Public, framework-free core of @devinoldenburg/opencode-tps-meter.
 *
 * Everything here is pure JS with no dependency on the OpenCode runtime or any
 * UI toolkit, so it can be imported by tests, the demo, or other tools:
 *
 *   import { RateMeter, messageStats, aggregate, buildView } from "@devinoldenburg/opencode-tps-meter/core";
 */

export { RateMeter } from "./meter.js";
export { GenerationTimer, DEFAULT_GAP_THRESHOLD_MS } from "./gen.js";
export {
  messageStats,
  aggregate,
  calibrateRatio,
  tokensFromChars,
  rate,
  isAssistant,
  DEFAULT_CHARS_PER_TOKEN,
} from "./tps.js";
export {
  fmtRate,
  fmtInt,
  fmtTokens,
  fmtMs,
  fmtCost,
  sparkline,
  bar,
  trimZero,
  SPARK_CHARS,
} from "./format.js";
export { buildView, renderText, VIEW_DEFAULTS } from "./view.js";
export { resolveConfig, TONE_TO_THEME, DEFAULTS, isFalsy } from "./config.js";
