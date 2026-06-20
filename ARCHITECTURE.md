# Architecture

`opencode-tps-meter` is split into a **pure measurement core** (no UI, no OpenCode
dependency — trivially unit-testable) and a **thin TUI adapter** that wires that core to the
OpenCode runtime. This document is the map.

```
plugins/
  tps-meter.tsx        ← TUI adapter (SolidJS / @opentui/solid). The ./tui entry.
  tps/
    gen.js             ← GenerationTimer: active-generation time (tool/wait excluded) → the TPS
    meter.js           ← RateMeter: windowed rate + EWMA — drives the sparkline only
    tps.js             ← per-message stats, pooled aggregates, chars→token calibration
    view.js            ← pure projection: measurements → tone-tagged render lines
    format.js          ← number / duration / cost formatters, sparkline, bars
    config.js          ← options + env → resolved config
    index.js           ← framework-free barrel (the ./core export)
tests/                 ← node --test over plugins/tps/*.js (62 tests, incl. server-sim)
tools/
  demo.mjs             ← replay a synthetic stream (with a tool gap) through the core
  verify-plugin.mjs    ← load the real TSX under Bun + @opentui/solid, verify wiring
  install-peers.mjs    ← install the optional @opentui/solid + solid-js peers for the verifier
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

## The number: active-generation TPS — `gen.js`

The TPS is **tokens ÷ active-generation time**, and active-generation time is measured from the
stream itself, not from the turn's wall-clock. A `GenerationTimer` is fed timestamped token
chunks and accumulates:

- **`activeMs`** — the sum of gaps *between* consecutive chunks, but only gaps **below**
  `gapThresholdMs` (default 1500 ms). A larger gap means the model stopped emitting — a tool
  call, a permission prompt, a stall — so it is **excluded** (summed into `idleMs`, counted in
  `gaps`). Real generation gaps are sub-second; tool calls are seconds; the threshold sits
  between, so generation is never excluded and waits always are.
- **prime tokens** — the first chunk of each burst (the very first, and the first after each
  excluded gap) was decoded during prefill/resume, *before* the timed window. Its tokens are
  recorded as `primeTokens` and excluded from the numerator. So `tps = (tokens − prime) ÷
  activeMs`, and a constant-rate stream measures its true rate **to the token** regardless of how
  many tool calls interrupt it.

The timer reads **no** wall clock itself (the caller passes timestamps), so it is deterministic
and unit-tested — including a server-stream simulation (`tests/gen.test.mjs`) where a 200 tok/s
stream with two 5 s tool gaps measures exactly 200 while naive wall-clock reads ~46.

### Exact at completion — `tps.js#messageStats`

While streaming, the timer's token counts are char-estimates. When the message completes,
`messageStats` recomputes the rate using the provider's **exact** `tokens.{output,reasoning}`
over the *same* measured `activeMs` (and the same prime offset). Live and final therefore agree —
the headline doesn't jump. The decode window is chosen by precision, best first: measured
`activeMs` → `completed − firstToken` → `completed − created`.

`aggregate()` combines messages by **pooling** — `Σ(decode tokens) ÷ Σ(active time)` — the
correct way to average rates of differing durations (a naive mean of per-message rates
over-weights short fast messages). Tests assert pooling diverges from the naive mean.

### The sparkline — `meter.js`

`RateMeter` is a separate, windowed estimator used **only for the sparkline** (visual texture).
`rate(now)` is a trailing-window average over `windowMs`; it dips when generation pauses (e.g.
during a tool call) and recovers when it resumes — which is exactly the behavior you want in the
sparkline while the headline (from `gen.js`) holds steady. `sample(now)` records the rate into a
ring buffer once per `pollMs` tick. It too reads no wall clock.

### Calibration — `tps.js#calibrateRatio`

Live deltas are *characters*; throughput is *tokens*. We convert with a per-model
characters-per-token ratio. When a message completes we know the exact token count and the
exact characters streamed, so `ratio ← EWMA(ratio, chars/tokens)` (clamped to `[1.2, 12]`). The
estimate is seeded at `4` (English-ish) and converges to the model's real tokenizer within a
message or two.

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

Two rules encoded here:

- **No native duplication.** OpenCode's Context section already shows token totals, % context,
  and cost, so the view shows throughput + TTFT + excluded-wait only. Token totals (`showTotals`)
  and cost (`showCost`) are off by default.
- `status` is authoritative for "is streaming" (`busy` ⇒ live, `idle`/`retry` ⇒ not), with the
  meter's trailing window only a fallback. So a completed turn switches cleanly to the exact
  figure instead of showing a stale live reading while the sparkline window drains.

## The TUI adapter — `tps-meter.tsx`

- Registers one renderer into the **stacking** `sidebar_content` slot (`api.slots.register`),
  so it's additive — it never replaces the native Context/MCP/LSP/Todo/Files sections (those
  register the same slot and coexist by `order`).
- Per session mount it owns a **`GenerationTimer` per message** (the precise rate), one
  `RateMeter` (the sparkline), a per-part length map, and the calibrated `ratio`. Streamed deltas
  feed both the message's timer and the meter; a `pollMs` interval re-samples the sparkline. The
  live headline is the in-flight message's `timer.tps()`; completed messages go through
  `messageStats` with that timer's measured timing. Maps are pruned on `message.removed` /
  `message.part.removed`; everything is torn down in `onCleanup`.
- A `createMemo` recomputes the view from reactive `api.state` plus a `tick` signal (bumped on
  events and on the interval), then renders inline `<span>` runs colored per tone.
- The whole `tui()` and every event handler are wrapped defensively: on any API drift it renders
  nothing rather than crashing the TUI.

## Why this split

- **Testability** — 62 deterministic tests over pure functions (incl. a server-stream
  simulation), no TUI harness needed.
- **Portability** — the core (`./core` export) is reusable from the demo, the tests, or any
  other tool.
- **Robustness** — the only runtime-coupled code is the thin adapter, and it fails closed.
