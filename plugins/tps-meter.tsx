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

const id = "opencode-tps-meter";

/**
 * The per-session sidebar view. One instance is mounted per session slot; it owns
 * a RateMeter and the calibration state for that session and tears them down on
 * cleanup.
 */
function TpsView(props) {
  const cfg = props.cfg;
  const theme = () => props.api.theme.current;
  const toneColor = (tone) => {
    const override = cfg.colors && cfg.colors[tone];
    if (override) return override;
    const t = theme() || {};
    return t[TONE_TO_THEME[tone] || "text"] || t.text;
  };

  // The sparkline uses a windowed instantaneous rate (visual texture). The PRECISE
  // numbers come from per-message GenerationTimers, which measure active-generation
  // time only — excluding tool calls, permission waits, and stalls inside a turn.
  const meter = new RateMeter({ windowMs: cfg.windowMs, seriesLength: cfg.seriesLength });
  const timers = new Map(); // messageID -> GenerationTimer (active-gen time, gap-excluded)
  const partLen = new Map(); // partID -> last observed text length
  let ratio = DEFAULT_CHARS_PER_TOKEN; // chars/token, self-calibrated per model
  let currentMsgId = null; // message currently streaming (for the live headline)

  const timerFor = (messageID) => {
    let t = timers.get(messageID);
    if (!t) {
      t = new GenerationTimer({ gapThresholdMs: cfg.gapMs });
      timers.set(messageID, t);
    }
    return t;
  };
  const timingFor = (messageID) => {
    const t = timers.get(messageID);
    return t
      ? { firstTokenAt: t.firstAt, activeMs: t.activeMs, idleMs: t.idleMs, gaps: t.gaps, primeTokens: t.primeTokens }
      : undefined;
  };

  const [tick, setTick] = createSignal(0);
  const bump = () => setTick((x) => (x + 1) % 1_000_000);

  // ── Precise live deltas + calibration via the event bus ────────────────────
  const offs = [];
  try {
    const bus = props.api.event;
    if (bus && typeof bus.on === "function") {
      const onPart = (event) => {
        try {
          const part = event?.properties?.part;
          if (!part || part.sessionID !== props.sessionID) return;
          if (part.type !== "text" && part.type !== "reasoning") return;
          const now = Date.now();
          const full = typeof part.text === "string" ? part.text.length : 0;
          const delta = event?.properties?.delta;
          const added =
            typeof delta === "string" && delta.length > 0
              ? delta.length
              : Math.max(0, full - (partLen.get(part.id) || 0));
          partLen.set(part.id, full);
          if (added > 0) {
            const tokens = tokensFromChars(added, ratio);
            if (part.messageID) {
              timerFor(part.messageID).push(tokens, now); // precise active-gen time
              currentMsgId = part.messageID;
            }
            meter.push(tokens, now); // windowed rate for the sparkline
            bump();
          }
        } catch {
          /* ignore a single malformed event */
        }
      };
      const onMessage = (event) => {
        try {
          const info = event?.properties?.info;
          if (info && info.sessionID === props.sessionID && isAssistant(info) && info.time?.completed) {
            const generated = (Number(info.tokens?.output) || 0) + (Number(info.tokens?.reasoning) || 0);
            let chars = 0;
            try {
              const parts = props.api.state.part(info.id) || [];
              for (const p of parts) {
                if ((p.type === "text" || p.type === "reasoning") && typeof p.text === "string") chars += p.text.length;
                // The part is finalized — drop its live delta-tracking entry so
                // partLen only ever holds the handful of currently-streaming parts.
                partLen.delete(p.id);
              }
            } catch {
              /* parts unavailable on this build — skip calibration this round */
            }
            if (chars > 0 && generated > 0) ratio = calibrateRatio(ratio, chars, generated);
            // Lock this message's timer to the exact generated count; the measured
            // active time is unchanged, so its rate becomes exact.
            const t = timers.get(info.id);
            if (t && generated > 0) t.setTokens(generated);
            if (currentMsgId === info.id) currentMsgId = null; // turn finished
          }
        } catch {
          /* ignore */
        }
        bump();
      };
      // Keep the per-message timers from accumulating orphans. A timer is needed for
      // as long as its message is in the session (the view recomputes exact stats
      // for all of them), so only drop it when the message is actually removed.
      const onMessageRemoved = (event) => {
        try {
          const messageID = event?.properties?.messageID;
          if (messageID) {
            timers.delete(messageID);
            if (currentMsgId === messageID) currentMsgId = null;
          }
        } catch {
          /* ignore */
        }
        bump();
      };
      const onPartRemoved = (event) => {
        try {
          const partID = event?.properties?.partID;
          if (partID) partLen.delete(partID);
        } catch {
          /* ignore */
        }
      };
      const subs = [
        ["message.part.updated", onPart],
        ["message.part.removed", onPartRemoved],
        ["message.updated", onMessage],
        ["message.removed", onMessageRemoved],
        ["session.status", onMessage],
        ["session.idle", onMessage],
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
    /* no event bus — the interval below still drives decay/idle reads */
  }

  // ── Live tick: re-sample the windowed rate (sparkline + decay) and repaint ──
  const timer = setInterval(() => {
    try {
      meter.sample(Date.now());
    } catch {
      /* ignore */
    }
    bump();
  }, cfg.pollMs);
  onCleanup(() => clearInterval(timer));
  onCleanup(() => {
    for (const off of offs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
  });

  // ── Derived view model: exact stats from reactive state + the live snapshot ─
  const view = createMemo(() => {
    tick(); // re-run on every live tick / event
    const now = Date.now();
    let messages = [];
    try {
      messages = props.api.state.session.messages(props.sessionID) || [];
    } catch {
      messages = [];
    }
    const stats = [];
    let last = null;
    let inflightId = null;
    for (const m of messages) {
      if (!isAssistant(m)) continue;
      const s = messageStats(m, timingFor(m.id));
      if (!s) continue;
      stats.push(s);
      if (s.done) last = s; // most-recent completed message
      else inflightId = m.id; // assistant message still streaming
    }
    const session = aggregate(stats);
    let status;
    try {
      status = props.api.state.session.status(props.sessionID)?.type;
    } catch {
      status = undefined;
    }
    // The live headline is the in-flight message's active-generation rate.
    const inflight = (inflightId && timers.get(inflightId)) || (currentMsgId && timers.get(currentMsgId)) || null;
    const live = {
      tps: inflight ? inflight.tps() : null,
      active: meter.active(now),
      series: meter.series(),
      peak: meter.peak,
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

  return (
    <Show when={view().state !== "none"}>
      <box flexDirection="column" paddingTop={1}>
        <For each={view().lines}>
          {(line) => (
            <text>
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
const tui = async (api, options) => {
  try {
    const cfg = resolveConfig(options, typeof process !== "undefined" ? process.env : {});
    if (!cfg.enabled) return;
    if (!api?.slots?.register) return; // runtime without the slot API → no-op
    api.slots.register({
      order: cfg.order,
      slots: {
        [cfg.slot](_ctx, props) {
          if (!props?.session_id) return undefined;
          return <TpsView api={api} sessionID={props.session_id} cfg={cfg} />;
        },
      },
    });
  } catch {
    /* TUI runtime missing or API drift — register nothing rather than crash. */
  }
};

export default { id, tui };
