# NOTES — opencode-tps-meter

**Task:** Build a precise tokens-per-second (TPS) meter as an OpenCode TUI sidebar
plugin. Same repo scheme as other OpenCode plugins (mirrors `opencode-goal-mode`).
Create it locally and as a **private** GitHub repo, but make it fully public-ready
(README, LICENSE, CHANGELOG, CI, tests, installer). Commit + push every small change.

**Where it lives:** `/Users/devin/development/2026-06-20/opencode-tps-meter`
GitHub: `github.com/devinoldenburg/opencode-tps-meter` (private for now).

## How OpenCode TUI plugins work (verified against installed 1.17.x)

- TUI plugins are SolidJS / `@opentui/solid` TSX modules. Entry resolved via package
  `exports["./tui"]`. Listed in `~/.config/opencode/tui.json` (`{"plugin": [...]}`).
- A plugin default-exports `{ id, tui }`. `tui(api, options, meta)` calls
  `api.slots.register({ order, slots: { sidebar_content(ctx, props) {...} } })`.
- Host sidebar slots: `sidebar_title`, `sidebar_content`, `sidebar_footer`
  (`props.session_id`).
- `api.state.session.messages(id)` / `api.state.part(messageID)` read live data.
- `api.event.on(type, fn)` streams events. `api.theme.current` gives colors.

## Where the precise numbers come from

- `AssistantMessage.tokens = { input, output, reasoning, cache:{read,write} }`,
  `time = { created, completed? }` (epoch ms), `cost`. Exact end-to-end TPS =
  `output / ((completed - created) / 1000)`.
- `message.part.updated` events carry `{ part, delta }` — each streamed chunk,
  timestamped on arrival → live windowed TPS + measured time-to-first-token.
- On completion we self-calibrate a chars→token ratio per model from the exact
  `output` count, so the live estimate tracks the provider's tokenizer.

## Layout (mirrors opencode-goal-mode)

- `plugins/tps-meter.tsx` — TUI sidebar plugin (the `./tui` entry).
- `plugins/tps/*.js` — pure, unit-tested core (meter math, formatting, projection).
- `tests/*.test.mjs` — `node --test`.
- `scripts/install.mjs` — wires the plugin into `~/.config/opencode`.
- `tools/demo.mjs` — replay a synthetic stream to see the meter without a model.
- `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `LICENSE`, CI workflow.
