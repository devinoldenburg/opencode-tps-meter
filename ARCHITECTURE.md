# Architecture

`opencode-tps-meter` is split into a **pure measurement core** (no UI, no OpenCode
dependency — trivially unit-testable) and a **thin TUI adapter** that wires that core to the
OpenCode runtime. This document is the map.

```
plugins/
  tps-meter.tsx        ← TUI adapter (SolidJS / @opentui/solid). The ./tui entry.
  tps/
    meter.js           ← RateMeter: live windowed TPS + EWMA + sparkline series
    tps.js             ← exact provider-reported stats, aggregates, calibration
    view.js            ← pure projection: measurements → tone-tagged render lines
    format.js          ← number / duration / cost formatters, sparkline, bars
    config.js          ← options + env → resolved config
    index.js           ← framework-free barrel (the ./core export)
tests/                 ← node --test over plugins/tps/*.js (51 tests)
tools/
  demo.mjs             ← replay a synthetic stream through the core (ANSI render)
  verify-plugin.mjs    ← load the real TSX under Bun + @opentui/solid, verify wiring
scripts/
  install.mjs          ← wire the plugin into an OpenCode config dir (the bin)
```

The golden rule: **anything that computes a number lives in `plugins/tps/*.js` and is tested.**
The `.tsx` only gathers inputs, owns lifecycle, and paints.

## Data sources (OpenCode runtime)

The adapter reads three things from the `TuiPluginApi`:

1. **`api.event.on("message.part.updated", …)`** — fires per streamed chunk with
   `{ part, delta }`. `part.type` is `"text"` or `"reasoning"` for generated content. `delta`
   is the new text. This is the live signal; we timestamp each chunk with `Date.now()` on
   arrival.
2. **`api.event.on("message.updated", …)`** — fires with the full `AssistantMessage` including
   final `tokens` and `time.completed`. This is the completion / calibration signal.
3. **`api.state.session.messages(id)` / `api.state.session.status(id)` / `api.state.part(id)`** —
   reactive reads for exact per-message stats, the busy/idle status, and the streamed parts
   (for calibration character counts).

The relevant shape of an assistant message:

```ts
AssistantMessage = {
  tokens: { input, output, reasoning, cache: { read, write } },  // provider-reported
  time:   { created, completed? },                               // epoch ms (server)
  cost, modelID, providerID, …
}
```

## The two regimes

### 1. Exact (authoritative) — `tps.js`

Once `time.completed` exists, throughput is computed directly:

- `e2eMs = completed − created` — the full turn, including prefill / time-to-first-token.
- `decodeMs = completed − firstTokenAt` — decode only, when we measured a TTFT; else falls
  back to `e2eMs`.
- `outputTps = output ÷ decodeSeconds`, `generatedTps = (output+reasoning) ÷ decodeSeconds`,
  `e2eTps = output ÷ e2eSeconds`.

`aggregate()` combines messages by **pooling** — `Σtokens ÷ Σtime` — which is the correct way
to average rates of differing durations (a naive mean of per-message rates over-weights short
fast messages). Tests assert pooling explicitly diverges from the naive mean.

### 2. Live (estimated) — `meter.js`

`RateMeter` is fed timestamped token deltas and reports:

- **`rate(now)`** — trailing-window average: tokens in the last `windowMs` ÷ the actual elapsed
  window. Unbiased once the stream has run `windowMs`; responsive before then (denominator is
  `now − startedAt`); decays to 0 over `windowMs` after the last token (because `now` keeps
  advancing while the window drains). A `minSpanMs` floor caps the first-few-chunk spike.
- **`smooth(now)`** — a continuous-time EWMA (half-life `halfLifeMs`) for an alternative,
  jitter-free headline; it decays for the idle gap since the last token.
- **`sample(now)`** — records the current `rate` into a fixed-length ring buffer (the sparkline)
  and tracks the peak. Called once per `pollMs` tick.

The meter reads **no** wall clock itself — the caller passes `now`/`t`. That makes it fully
deterministic and unit-testable (the tests feed fixed timestamps; the plugin feeds
`Date.now()`).

### Calibration — `tps.js#calibrateRatio`

Live deltas are *characters*; throughput is *tokens*. We convert with a per-model
characters-per-token ratio. When a message completes we know the exact token count and the
exact characters streamed, so `ratio ← EWMA(ratio, chars/tokens)` (clamped to `[1.2, 12]`). The
estimate is seeded at `4` (English-ish) and converges to the model's real tokenizer within a
message or two.

## The view projection — `view.js`

`buildView({ live, last, session, status, config })` returns `{ state, lines }`, where each line
is `{ key, segments: [{ text, tone }] }` and `tone` is a semantic color name
(`header｜accent｜value｜good｜warn｜muted｜label`). The adapter maps tones → theme colors.

Keeping the projection pure means the **entire sidebar layout is asserted in tests**, character
for character, with no terminal involved (`renderText()` flattens a view to plain strings).

Key rule encoded here: `status` is authoritative for "is streaming" (`busy` ⇒ live, `idle`/
`retry` ⇒ not), with the meter's trailing window only a fallback. So a completed message
switches cleanly from the live estimate to the exact figure instead of showing a stale live
reading while its rate window drains.

## The TUI adapter — `tps-meter.tsx`

- Registers one renderer into the **stacking** `sidebar_content` slot (`api.slots.register`),
  so it's additive — it never replaces the native Context/MCP/LSP/Todo/Files sections (those
  register the same slot and coexist by `order`).
- Per session mount it owns a `RateMeter`, a `firstTokenAt` map, a per-part length map, and the
  calibrated `ratio`. Event subscriptions feed the meter; a `pollMs` interval re-samples so the
  sparkline animates and decays. Everything is torn down in `onCleanup`.
- A `createMemo` recomputes the view from reactive `api.state` plus a `tick` signal (bumped on
  events and on the interval), then renders inline `<span>` runs colored per tone.
- The whole `tui()` and every event handler are wrapped defensively: on any API drift it renders
  nothing rather than crashing the TUI.

## Why this split

- **Testability** — 51 deterministic tests over pure functions, no TUI harness needed.
- **Portability** — the core (`./core` export) is reusable from the demo, the tests, or any
  other tool.
- **Robustness** — the only runtime-coupled code is the thin adapter, and it fails closed.
