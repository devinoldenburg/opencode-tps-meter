/**
 * format.js — pure display helpers (numbers, durations, sparklines, bars).
 *
 * No rendering framework here: everything returns plain strings so it is trivial
 * to unit test and reusable from the TUI plugin, the demo, and tests alike.
 */

/** Eight-level vertical bars, lowest → highest. */
export const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Format a tokens-per-second value. Compact and stable-width-ish:
 *   <10     → one decimal   (e.g. "8.4")
 *   <1000   → integer       (e.g. "247")
 *   >=1000  → "k" with one decimal (e.g. "1.2k")
 * `null`/non-finite → the placeholder (default "–").
 */
export function fmtRate(value, placeholder = "–") {
  if (value === null || value === undefined) return placeholder; // unknown, not zero
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return placeholder;
  if (n >= 1000) return trimZero((n / 1000).toFixed(1)) + "k";
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return trimZero(n.toFixed(1));
  return trimZero(n.toFixed(1));
}

/** Integer with thousands separators. */
export function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Token counts: <1000 plain, else "k"/"M" with one decimal. */
export function fmtTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return trimZero((n / 1_000_000).toFixed(1)) + "M";
  if (abs >= 1000) return trimZero((n / 1000).toFixed(1)) + "k";
  return String(Math.round(n));
}

/** Durations: <1000ms → "850ms", <60s → "2.4s", else "1m04s". */
export function fmtMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "–";
  if (n < 1000) return `${Math.round(n)}ms`;
  const s = n / 1000;
  if (s < 60) return `${trimZero(s.toFixed(s < 10 ? 1 : 0))}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${String(rem).padStart(2, "0")}s`;
}

/** Cost in USD: "$0.0123" small, "$1.23" larger, "$0" for zero. */
export function fmtCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n < 0.01) return "$" + n.toFixed(4);
  if (n < 1) return "$" + n.toFixed(3);
  return "$" + n.toFixed(2);
}

/**
 * Render a numeric series as a unicode sparkline.
 *
 * @param {number[]} values
 * @param {object} [opts]
 * @param {number} [opts.width]   Render exactly this many cells (right-aligned;
 *   pads the left with the empty char, truncates from the left to keep the most
 *   recent values). Defaults to `values.length`.
 * @param {number} [opts.max]     Scale ceiling. Defaults to the series max (so a
 *   flat series renders flat rather than maxed). Pass a fixed max for an absolute
 *   scale across renders.
 * @param {number} [opts.min=0]   Scale floor.
 * @param {string} [opts.empty="▁"] Glyph for empty/zero-scale cells.
 */
export function sparkline(values, opts = {}) {
  const arr = Array.isArray(values) ? values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [];
  const width = Number.isFinite(Number(opts.width)) ? Math.max(0, Math.floor(Number(opts.width))) : arr.length;
  const empty = typeof opts.empty === "string" && opts.empty.length ? opts.empty : SPARK_CHARS[0];
  if (width === 0) return "";

  // Take the most recent `width` values; left-pad with empties when short.
  let cells = arr;
  let pad = 0;
  if (arr.length >= width) cells = arr.slice(arr.length - width);
  else pad = width - arr.length;

  const min = Number.isFinite(Number(opts.min)) ? Number(opts.min) : 0;
  const max = Number.isFinite(Number(opts.max)) ? Number(opts.max) : Math.max(min, ...cells, 0);
  const range = max - min;

  const body = cells
    .map((v) => {
      if (range <= 0) return empty;
      const frac = (v - min) / range;
      const clamped = Math.min(1, Math.max(0, frac));
      const idx = Math.min(SPARK_CHARS.length - 1, Math.round(clamped * (SPARK_CHARS.length - 1)));
      return SPARK_CHARS[idx];
    })
    .join("");

  return empty.repeat(pad) + body;
}

/**
 * Horizontal proportional bar, e.g. `bar(0.6, 10)` → "██████░░░░".
 */
export function bar(fraction, width = 10, full = "█", rest = "░") {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  const filled = Math.round(f * w);
  return full.repeat(filled) + rest.repeat(Math.max(0, w - filled));
}

/** Strip a trailing ".0" (or trailing zeros after a decimal) for compact display. */
export function trimZero(str) {
  const s = String(str);
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}
