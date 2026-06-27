/** @jsxImportSource @opentui/solid */
/**
 * opencode-tps-meter — a precise tokens-per-second meter for the OpenCode TUI
 * sidebar.
 *
 * It adds one section to the sidebar (the stacking `sidebar_content` slot, so it
 * sits alongside the native Context / MCP / LSP / Todo / Files sections without
 * replacing any of them) showing:
 *
 *   - a **live** windowed TPS headline + sparkline while a message streams,
 *   - the **last** message's exact, provider-reported throughput (with measured
 *     time-to-first-token and decode duration),
 *   - **session** averages (pooled), peak, total tokens, and cost.
 *
 * How the numbers are produced (see ./tps/* for the pure, unit-tested core):
 *   - Live TPS: every `message.part.updated` carries a streamed `delta`; we
 *     timestamp each chunk on arrival (Date.now()), convert characters→tokens
 *     with a per-model calibrated ratio, and feed a trailing-window RateMeter.
 *     A short interval re-samples so the meter animates and decays to 0 when the
 *     stream stops. The first chunk's arrival gives us a real TTFT.
 *   - Exact TPS: on `message.updated` the assistant message carries the
 *     provider's token counts and server timestamps — the ground truth. We also
 *     use the exact `output` count to recalibrate the chars→token ratio, so the
 *     live estimate tracks the real tokenizer over time.
 *
 * Loading: OpenCode resolves TUI plugins via the package's `exports["./tui"]`
 * (→ this file) and the `@opentui/solid` + `solid-js` peer runtime it injects.
 * Everything is wrapped defensively: on any API drift the section renders
 * nothing rather than crashing the TUI.
 */

import { createMemo, createSignal, onCleanup, For, Show } from "solid-js";
import { RateMeter } from "./tps/meter.js";
import { GenerationTimer } from "./tps/gen.js";
import {
  messageStats,
  aggregate,
  calibrateRatio,
  tokensFromChars,
  isAssistant,
  DEFAULT_CHARS_PER_TOKEN,
} from "./tps/tps.js";
import { buildView } from "./tps/view.js";
import { resolveConfig, TONE_TO_THEME } from "./tps/config.js";
import {
  resolveSessionID,
  messageInfo,
  eventSessionID,
  eventBelongsToView,
  removalSessionID,
  removalMessageID,
  generatedTokens,
  summaryMessage,
} from "./tps/session.js";
import { parsePartDelta, partCharsAdded, liveHeadlineTps } from "./tps/adapter.js";

const id = "opencode-tps-meter";
type AnyRecord = Record<string, any>;

/**
 * The per-session sidebar view. One instance is mounted per session slot; it owns
 * a RateMeter and the calibration state for that session and tears them down on
 * cleanup.
 */
function TpsView(props: AnyRecord) {
  const cfg = props.cfg as AnyRecord;
  const viewSessionID = () => String(props.sessionID);
  const theme = () => props.api.theme.current;
  const toneColor = (tone: string) => {
    const override = cfg.colors && cfg.colors[tone];
    if (override) return override;
    const t = theme() || {};
    const themeKey = (TONE_TO_THEME as Record<string, string>)[tone] || "text";
    return t[themeKey] || t.text;
  };

  const meter = new RateMeter({ windowMs: cfg.windowMs, seriesLength: cfg.seriesLength });
  const timers = new Map<string, GenerationTimer>();
  const observedMessages = new Map<string, AnyRecord>();
  const partLen = new Map<string, { length: number; messageID?: string }>();
  const ratioByModel = new Map<string, number>();
  let currentMsgId: string | null = null;

  const modelKey = (info: AnyRecord | null | undefined) => `${info?.providerID ?? ""}/${info?.modelID ?? ""}`;
  const ratioFor = (info: AnyRecord | null | undefined) => ratioByModel.get(modelKey(info)) ?? DEFAULT_CHARS_PER_TOKEN;

  const currentSession = () => {
    try {
      return (props.api.state.session.get(viewSessionID()) as AnyRecord) || null;
    } catch {
      return null;
    }
  };

  const timerFor = (messageID: string) => {
    let t = timers.get(messageID);
    if (!t) {
      t = new GenerationTimer({ gapThresholdMs: cfg.gapMs });
      timers.set(messageID, t);
    }
    return t;
  };
  const timingFor = (messageID: string) => {
    const t = timers.get(messageID);
    return t
      ? { firstTokenAt: t.firstAt, activeMs: t.activeMs, idleMs: t.idleMs, gaps: t.gaps, primeTokens: t.primeTokens }
      : undefined;
  };

  const [tick, setTick] = createSignal(0);
  const bump = () => setTick((x) => (x + 1) % 1_000_000);
  let timer: ReturnType<typeof setInterval> | null = null;
  let summaryCursor: { id: string; generated: number } | null = null;
  let summaryLiveId: string | null = null;

  const clearSummaryLive = () => {
    if (summaryLiveId) {
      timers.delete(summaryLiveId);
      if (currentMsgId === summaryLiveId) currentMsgId = null;
      summaryLiveId = null;
    }
  };

  const pollSessionSummary = () => {
    const current = currentSession();
    const generated = generatedTokens(current?.tokens);
    const sid = viewSessionID();
    const id = String(current?.id ?? sid);
    if (!current || generated <= 0) {
      if (generated <= 0) {
        summaryCursor = null;
        clearSummaryLive();
      }
      return current;
    }
    if (!summaryCursor || summaryCursor.id !== id || generated < summaryCursor.generated) {
      summaryCursor = { id, generated };
      clearSummaryLive();
      return current;
    }
    const added = generated - summaryCursor.generated;
    summaryCursor = { id, generated };
    if (added > 0) {
      const now = Date.now();
      summaryLiveId = `${id}:summary-live`;
      timerFor(summaryLiveId).push(added, now);
      currentMsgId = summaryLiveId;
      meter.push(added, now);
      bump();
    }
    return current;
  };

  onCleanup(() => {
    if (timer !== null) clearInterval(timer);
    clearSummaryLive();
    timers.clear();
    observedMessages.clear();
    partLen.clear();
  });

  const offs: Array<() => void> = [];
  try {
    const bus = props.api.event;
    if (bus && typeof bus.on === "function") {
      const onPart = (event: AnyRecord) => {
        try {
          const parsed = parsePartDelta(viewSessionID(), event);
          if (!parsed.ok) return;
          const { messageID, partID, full, deltaLen } = parsed;
          const now = Date.now();
          const prev = partLen.get(partID);
          const added = partCharsAdded(full, deltaLen, prev);
          const storedLength = Math.max(full, (prev?.length || 0) + Math.max(0, added));
          partLen.set(partID, { length: storedLength, messageID });

          if (added > 0) {
            const msg = messageID ? safeMessage(messageID) : null;
            const tokens = tokensFromChars(added, ratioFor(msg));
            if (messageID) {
              timerFor(messageID).push(tokens, now);
              currentMsgId = messageID;
            }
            meter.push(tokens, now);
            bump();
          }
        } catch {
          /* ignore a single malformed event */
        }
      };

      const onMessage = (event: AnyRecord) => {
        try {
          const ev = event?.properties || {};
          const info = messageInfo(ev.info ?? ev.message ?? ev) as AnyRecord;
          const evSession = info?.sessionID ?? eventSessionID(ev, null);
          if (!eventBelongsToView(viewSessionID(), evSession)) return;

          if (info && isAssistant(info) && info.id) {
            observedMessages.set(info.id, info);
          }
          if (info && isAssistant(info) && info.time?.completed) {
            const generated = generatedTokens(info.tokens);
            let chars = 0;
            try {
              const parts = props.api.state.part(info.id) || [];
              for (const p of parts) {
                if ((p.type === "text" || p.type === "reasoning") && typeof p.text === "string") chars += p.text.length;
                partLen.delete(p.id);
              }
            } catch {
              for (const [partID, state] of partLen) {
                if (state.messageID === info.id) {
                  chars += state.length;
                  partLen.delete(partID);
                }
              }
            }
            if (chars > 0 && generated > 0) {
              const key = modelKey(info);
              ratioByModel.set(key, calibrateRatio(ratioByModel.get(key), chars, generated));
            }
            const t = timers.get(info.id);
            if (t && generated > 0) t.setTokens(generated);
            if (currentMsgId === info.id) currentMsgId = null;
            if (summaryLiveId && info.id && !String(info.id).endsWith(":summary")) clearSummaryLive();
          }
        } catch {
          /* ignore */
        }
        bump();
      };

      const onMessageRemoved = (event: AnyRecord) => {
        try {
          const ev = event?.properties || {};
          const evSession = removalSessionID(ev);
          if (!eventBelongsToView(viewSessionID(), evSession)) return;
          const messageID = removalMessageID(ev);
          if (messageID) {
            timers.delete(messageID);
            observedMessages.delete(messageID);
            if (currentMsgId === messageID) currentMsgId = null;
            for (const [partID, state] of partLen) {
              if (state.messageID === messageID) partLen.delete(partID);
            }
          }
        } catch {
          /* ignore */
        }
        bump();
      };

      const onPartRemoved = (event: AnyRecord) => {
        try {
          const ev = event?.properties || {};
          const part = ev.part && typeof ev.part === "object" ? ev.part : null;
          const evSession = eventSessionID(ev, part);
          if (!eventBelongsToView(viewSessionID(), evSession)) return;
          const partID = ev.partID ?? ev.part_id ?? ev.id ?? ev.part?.id;
          if (partID) partLen.delete(partID);
        } catch {
          /* ignore */
        }
      };

      const onSessionSignal = () => {
        try {
          pollSessionSummary();
        } catch {
          /* ignore */
        }
        bump();
      };

      const subs: Array<[string, (e: AnyRecord) => void]> = [
        ["message.part.updated", onPart],
        ["message.part.delta", onPart],
        ["session.next.text.delta", onPart],
        ["session.next.reasoning.delta", onPart],
        ["session.next.text.ended", onPart],
        ["session.next.reasoning.ended", onPart],
        ["message.part.removed", onPartRemoved],
        ["message.updated", onMessage],
        ["message.removed", onMessageRemoved],
        ["session.status", onSessionSignal],
        ["session.idle", onSessionSignal],
        ["session.updated", onSessionSignal],
      ];
      for (const [ev, fn] of subs) {
        try {
          const off = bus.on(ev, fn);
          if (typeof off === "function") offs.push(off);
        } catch {
          /* event not supported on this build — skip it */
        }
      }
    }
  } catch {
    /* no event bus */
  }

  timer = setInterval(() => {
    try {
      pollSessionSummary();
      meter.sample(Date.now());
    } catch {
      /* ignore */
    }
    bump();
  }, cfg.pollMs);

  onCleanup(() => {
    for (const off of offs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
  });

  function safeMessage(messageID: string) {
    try {
      const stateMessages = props.api.state.session.messages(viewSessionID()) || [];
      const raw =
        stateMessages.find((m: AnyRecord) => (messageInfo(m) as AnyRecord)?.id === messageID || m?.id === messageID) ||
        observedMessages.get(messageID) ||
        null;
      return messageInfo(raw) || null;
    } catch {
      return observedMessages.get(messageID) || null;
    }
  }

  const view = createMemo(() => {
    tick();
    const now = Date.now();
    let messages: AnyRecord[] = [];
    try {
      messages = props.api.state.session.messages(viewSessionID()) || [];
    } catch {
      messages = [];
    }
    if (observedMessages.size) {
      const merged = new Map<string, AnyRecord>();
      for (const raw of messages) {
        const info = messageInfo(raw) as AnyRecord;
        if (info?.id) merged.set(info.id, raw);
      }
      for (const [mid, info] of observedMessages) merged.set(mid, info);
      messages = [...merged.values()];
    }
    const stats: AnyRecord[] = [];
    let last: AnyRecord | null = null;
    let inflightId: string | null = null;
    for (const raw of messages) {
      const m = messageInfo(raw) as AnyRecord;
      if (!isAssistant(m)) continue;
      const s = messageStats(m, timingFor(m.id)) as AnyRecord | null;
      if (!s) continue;
      stats.push(s);
      if (s.done) last = s;
      else inflightId = m.id;
    }
    if (stats.length === 0) {
      const summary = messageStats(summaryMessage(currentSession(), viewSessionID()), undefined) as AnyRecord | null;
      if (summary) {
        stats.push(summary);
        last = summary;
      }
    }
    const session = aggregate(stats);
    let status: string | undefined;
    try {
      status = props.api.state.session.status(viewSessionID())?.type;
    } catch {
      status = undefined;
    }
    const inflight =
      (inflightId && timers.get(inflightId)) ||
      (summaryLiveId && timers.get(summaryLiveId)) ||
      (currentMsgId && timers.get(currentMsgId)) ||
      null;
    const streamingActive = meter.active(now) || (inflight !== null && (inflight.tps() ?? 0) > 0);
    const live = {
      tps: liveHeadlineTps(inflight, meter, now),
      active: streamingActive,
      series: meter.series(),
      peak: Math.max(meter.peak, inflight ? inflight.tps() ?? 0 : 0),
      gaps: inflight ? inflight.gaps : 0,
      idleMs: inflight ? inflight.idleMs : 0,
    };
    return buildView({
      live,
      last,
      session,
      status,
      config: {
        metric: cfg.metric,
        detail: cfg.detail,
        icon: cfg.icon,
        label: cfg.label,
        unit: cfg.unit,
        sparkWidth: cfg.sparkWidth,
        showSparkline: cfg.showSparkline,
        showSession: cfg.showSession,
        showWaits: cfg.showWaits,
        showTotals: cfg.showTotals,
        showCost: cfg.showCost,
        showCache: cfg.showCache,
      },
    });
  });

  const lineStyle = (key: string) => {
    if (key === "title" || key === "header") return { fg: toneColor("header") };
    if (key === "rate") return { fg: toneColor("value") };
    if (key === "spark") return { fg: toneColor("spark") };
    return undefined;
  };

  return (
    <Show when={view().state !== "none"}>
      <box flexDirection="column" gap={0}>
        <For each={view().lines}>
          {(line) => (
            <text style={lineStyle(line.key)}>
              <For each={line.segments}>
                {(seg) =>
                  seg.tone === "header" ? (
                    <span style={{ fg: toneColor(seg.tone) }}>
                      <b>{seg.text}</b>
                    </span>
                  ) : (
                    <span style={{ fg: toneColor(seg.tone) }}>{seg.text}</span>
                  )
                }
              </For>
            </text>
          )}
        </For>
      </box>
    </Show>
  );
}

/** @type {import("@opencode-ai/plugin/tui").TuiPlugin} */
const tui = async (api: AnyRecord, options: AnyRecord) => {
  try {
    const cfg = resolveConfig(options, typeof process !== "undefined" ? process.env : {}) as AnyRecord;
    if (!cfg.enabled) return;
    if (!api?.slots?.register) return;
    api.slots.register({
      order: cfg.order,
      slots: {
        [cfg.slot](ctx: AnyRecord, slotProps?: AnyRecord) {
          const sessionID = resolveSessionID(ctx, slotProps, api);
          if (!sessionID) return undefined;
          return <TpsView api={api} sessionID={sessionID} cfg={cfg} />;
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
        process.emitWarning(`opencode-tps-meter: failed to register TUI plugin — ${msg}`, {
          code: "OPENCODE_TPS_METER_INIT",
        });
      } else if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn(`opencode-tps-meter: failed to register TUI plugin — ${msg}`);
      }
    } catch {
      /* never crash the host on diagnostics */
    }
  }
};

export default { id, tui };