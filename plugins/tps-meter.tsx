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

  const meter = new RateMeter({ windowMs: cfg.windowMs, seriesLength: cfg.seriesLength });
  const firstTokenAt = new Map(); // messageID -> first-chunk arrival (ms)
  const partLen = new Map(); // partID -> last observed text length
  let ratio = DEFAULT_CHARS_PER_TOKEN; // chars/token, self-calibrated per model

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
            if (part.messageID && !firstTokenAt.has(part.messageID)) firstTokenAt.set(part.messageID, now);
            meter.push(tokensFromChars(added, ratio), now);
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
          }
        } catch {
          /* ignore */
        }
        bump();
      };
      // Cleanup handlers so the per-session maps don't accumulate orphans. We must
      // keep firstTokenAt for every *live* message (the view recomputes exact
      // decode-window stats for all of them), so we only drop an entry when its
      // message is actually removed from the session.
      const onMessageRemoved = (event) => {
        try {
          const messageID = event?.properties?.messageID;
          if (messageID) firstTokenAt.delete(messageID);
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
    for (const m of messages) {
      if (!isAssistant(m)) continue;
      const s = messageStats(m, firstTokenAt.get(m.id));
      if (!s) continue;
      stats.push(s);
      if (s.done) last = s; // most-recent completed message
    }
    const session = aggregate(stats);
    let status;
    try {
      status = props.api.state.session.status(props.sessionID)?.type;
    } catch {
      status = undefined;
    }
    return buildView({
      live: meter.snapshot(now),
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
        showCost: cfg.showCost,
        showCache: cfg.showCache,
        showSession: cfg.showSession,
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
