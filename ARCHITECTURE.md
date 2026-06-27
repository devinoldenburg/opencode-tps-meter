# Architecture

`opencode-tps-meter` splits a **pure measurement core** (no UI, no OpenCode dependency) from a
**TUI adapter** that wires the core to the OpenCode runtime.

```
plugins/
  tps-meter.tsx        ← TUI adapter (SolidJS / @opentui/solid). Export: ./tui
  tps/
    gen.js             ← GenerationTimer — active-generation time (waits excluded)
    meter.js           ← RateMeter — trailing window + EWMA (sparkline texture)
    tps.js             ← messageStats, aggregate, calibration
    view.js            ← buildView — measurements → tone-tagged lines
    format.js          ← fmtRate, sparkline, …
    config.js          ← resolveConfig (options + env)
    session.js         ← session id + event payload normalization
    adapter.js         ← parsePartDelta, liveHeadlineTps (TUI event helpers)
    index.js           ← ./core barrel
tests/                 ← node --test (92 tests)
tools/
  demo.mjs             ← synthetic stream replay (optional --ci)
  verify-plugin.mjs    ← Bun + @opentui/solid plugin smoke test
  install-peers.mjs
scripts/
  install.mjs          ← package bin (wire into ~/.config/opencode)
```

**Rule:** numbers and layout logic live in `plugins/tps/*.js` and are tested. The `.tsx` gathers
inputs, subscribes to events, and renders.

## OpenCode inputs

The adapter uses `TuiPluginApi`:

1. **Events** — `message.part.updated`, `message.part.delta`, `session.next.text.delta`,
   `session.next.reasoning.delta`, `message.updated`, `message.removed`, `session.status`,
   `session.idle`, `session.updated`, and related part-removal events. Payload shapes vary by
   OpenCode version; `session.js` / `adapter.js` normalize session ids and deltas.
2. **State** — `api.state.session.messages(id)`, `session.get(id)`, `session.status(id)`,
   `api.state.part(messageId)` for exact stats and calibration character counts.
3. **Slot** — `resolveSessionID(ctx, slotProps, api)` resolves the sidebar session from
   `session_id` / `sessionID`, route params, or `session.current()`.

Assistant messages carry provider `tokens`, `time.{created,completed}`, `cost`, `modelID`,
`providerID`.

## Active-generation TPS (`gen.js`)

`GenerationTimer` sums inter-chunk gaps below `gapThresholdMs` into `activeMs`. Larger gaps are
waits (`idleMs`, `gaps`). Prime tokens after each burst are excluded from the numerator so
constant-rate streams measure correctly across tool interruptions.

On completion, `messageStats` uses exact provider token counts over the same `activeMs`.
`aggregate()` pools Σtokens ÷ Σactive time (not a mean of per-message rates).

## Headline vs sparkline

- **Headline** — `liveHeadlineTps()` prefers `GenerationTimer.tps()`; otherwise smoothed window
  rate while the meter is active (`adapter.js`).
- **Sparkline** — `RateMeter.sample()` / `series()` only; dips during pauses while the headline
  can hold steady.

## Calibration (`tps.js`)

Per-model chars→tokens via EWMA on completed messages, clamped to `[0.25, 12]` (`MIN_RATIO` /
`MAX_RATIO`).

## View (`view.js`)

`buildView({ live, last, session, status, config })` → `{ state, lines }`. With no history yet,
compact/full layouts show the section label and `waiting for tokens` (state `idle`, not hidden).
`status === "busy"` forces live mode; idle/retry use exact last message stats.

## TUI adapter (`tps-meter.tsx`)

- Registers `sidebar_content` at configurable `order` (default 150).
- Per session: `GenerationTimer` map, one `RateMeter`, `observedMessages`, `partLen`,
  `ratioByModel`. Session-scoped events via `eventBelongsToView` (unscoped events ignored).
- `session.get()` token-growth polling when message arrays are empty.
- Defensive wrappers: init failures emit `OPENCODE_TPS_METER_INIT`; render errors fail closed.

## CI

[`ci.yml`](./.github/workflows/ci.yml): `npm test`, `tsc --noEmit`, demo `--ci`, pack check,
Bun `verify:plugin`. [`release.yml`](./.github/workflows/release.yml) runs the same checks before
npm publish.

## Why split core / adapter

- **Testability** — deterministic unit + integration tests without a TUI.
- **Portability** — import `@devinoldenburg/opencode-tps-meter/core` from tools and tests.
- **Robustness** — only the adapter depends on OpenCode + Solid peer runtime.