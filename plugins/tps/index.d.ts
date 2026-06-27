export class RateMeter {
  constructor(opts?: { windowMs?: number; minSpanMs?: number; seriesLength?: number; halfLifeMs?: number });
  reset(): void;
  push(tokens: number, t: number): this;
  rate(now: number): number;
  smooth(now: number): number;
  sample(now: number): number;
  active(now: number): boolean;
  series(): number[];
  readonly peak: number;
  readonly total: number;
  readonly count: number;
}

export class GenerationTimer {
  constructor(opts?: { gapThresholdMs?: number });
  reset(): void;
  push(tokens: number, t: number): this;
  setTokens(exact: number): this;
  tps(): number | null;
  snapshot(): Record<string, unknown>;
  readonly activeMs: number;
  readonly idleMs: number;
  readonly gaps: number;
  readonly tokens: number;
  readonly firstAt: number | null;
  readonly lastAt: number | null;
  readonly primeTokens: number;
  readonly decodeTokens: number;
}

export const DEFAULT_GAP_THRESHOLD_MS: number;
export const DEFAULT_CHARS_PER_TOKEN: number;
export const SPARK_CHARS: string[];
export function messageStats(msg: unknown, timing?: number | object): object | null;
export function aggregate(statList: Array<object | null>): object;
export function calibrateRatio(prev: number | null | undefined, chars: number, tokens: number, alpha?: number): number;
export function tokensFromChars(chars: number, ratio?: number): number;
export function rate(tokens: number, ms: number): number | null;
export function isAssistant(msg: unknown): boolean;
export function fmtRate(value: unknown, placeholder?: string): string;
export function fmtInt(value: unknown): string;
export function fmtTokens(value: unknown): string;
export function fmtMs(value: unknown): string;
export function fmtCost(value: unknown): string;
export function sparkline(values: number[], opts?: object): string;
export function bar(fraction: number, width?: number, full?: string, rest?: string): string;
export function trimZero(str: string): string;
export function buildView(input?: object): object;
export function renderText(view: object): string;
export const VIEW_DEFAULTS: object;
export function resolveConfig(options?: object, env?: object): object;
export const TONE_TO_THEME: object;
export const DEFAULTS: object;
export function isFalsy(value: unknown): boolean;
export function resolveSessionID(ctx?: object, slotProps?: object, api?: object): string | undefined;
export function messageInfo(raw: unknown): Record<string, unknown> | null;
export function eventSessionID(evProps: object, part?: object | null): unknown;
export function deltaTextLength(value: unknown): number;
export function generatedTokens(tokens?: object | null): number;
export function summaryMessage(current?: object | null, fallbackSessionID?: string): object | null;
declare const plugin: { id: string; tui: (...args: unknown[]) => Promise<unknown> };
export default plugin;
