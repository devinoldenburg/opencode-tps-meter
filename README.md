# opencode-tps-meter

A **precise tokens-per-second (TPS) meter** for the [OpenCode](https://opencode.ai) TUI sidebar.
It shows how fast the model is actually generating — live while it streams, then the exact
provider-reported throughput once the turn completes — without replacing any of OpenCode's
native sidebar sections.

[![CI](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![OpenCode plugin](https://img.shields.io/badge/OpenCode-TUI%20plugin-7c5cff.svg)](https://opencode.ai)
![node >= 20.11](https://img.shields.io/badge/node-%3E%3D20.11-3c873a.svg)

```text
TPS  241 tok/s                   TPS  237 tok/s
▁▁▁▁▁▁▂▆▇████████████████   →    ██████████████▇▇▇▆▆▆▅▅▄▄▄
now  622 tok · peak 248          last 237 tok/s  ttft 650ms · 1.1k tok · 4.6s
                                 avg  237 tok/s  peak 237
   while streaming               Σ    1.1k tok · 1 msg · $0.0099
                                    after the turn completes
```

> Try it right now without OpenCode: `node tools/demo.mjs` (animated) or `node tools/demo.mjs --ci`.

---

## Why another meter?

OpenCode's sidebar already shows token **totals** and context usage. This plugin answers a
different question — **how fast?** — and answers it precisely, distinguishing the things that
are usually conflated:

| Measurement | What it means | How it's measured |
|---|---|---|
| **Live TPS** | Throughput *right now*, while streaming | Trailing-window rate over streamed deltas, each timestamped on arrival |
| **TTFT** | Time-to-first-token (prefill / queue latency) | Wall-clock from request start to the first streamed chunk |
| **Decode TPS** | The model's raw emit speed, *excluding* prefill | `output ÷ (completed − first-token)` |
| **End-to-end TPS** | What you actually feel for the whole turn | `output ÷ (completed − created)` |
| **Session avg** | Combined speed across the session | **Pooled** (Σtokens ÷ Σtime), not a naive mean of rates |

Every headline number is **exact** the moment a message completes: it uses the provider's own
token counts (`tokens.output` / `tokens.reasoning`) and OpenCode's server timestamps, not an
estimate. The *live* number is a calibrated estimate while streaming — see
[Precision](#how-precise-is-it) below.

## Features

- **Live windowed TPS + sparkline** that animates while the model streams and decays to zero
  when it stops.
- **Exact, provider-reported throughput** for the last message (output and, optionally,
  output+reasoning), with **measured time-to-first-token** and decode duration.
- **Session aggregates** — pooled average TPS, peak, total tokens, message count, and cost.
- **Self-calibrating** characters→token ratio, learned per model from each completed message's
  exact token count, so the live estimate tracks the real tokenizer over time.
- **Additive** — renders into the stacking `sidebar_content` slot, so your Context / MCP / LSP /
  Todo / Files sections stay exactly where they are.
- **Theme-aware** colors, with full per-tone overrides.
- **Crash-proof** — any API drift renders nothing rather than taking down the TUI.
- **Measured** — 51 unit tests over a pure, framework-free core; numbers verified against
  hand-computed expectations.

## Install

### Quick (recommended)

```bash
npm install -g opencode-tps-meter   # once published
opencode-tps-meter                  # wires it into ~/.config/opencode and installs
```

…or run the installer straight from a clone (works today, before any npm publish):

```bash
git clone https://github.com/devinoldenburg/opencode-tps-meter
cd opencode-tps-meter
node scripts/install.mjs --local     # links THIS checkout via a file: dependency
```

Then **restart the OpenCode TUI** — a `TPS` section appears in the sidebar.

Installer flags: `--local`, `--dir <path>`, `--no-install`, `--dry-run`, `--uninstall`, `--print`.

### Manual

Add it to your OpenCode config dir (e.g. `~/.config/opencode`):

```jsonc
// tui.json
{ "$schema": "https://opencode.ai/tui.json", "plugin": ["opencode-tps-meter"] }
```

```jsonc
// package.json  (so the TUI can resolve it from node_modules)
{ "dependencies": { "opencode-tps-meter": "latest" } }
```

then `npm install` in that directory and restart the TUI.

## Configuration

Pass options via the OpenCode plugin tuple in `tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    ["opencode-tps-meter", { "metric": "generated", "windowMs": 2000, "detail": "compact" }]
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `enabled` | `true` | Set `false` to disable without uninstalling. |
| `order` | `150` | Position among sidebar sections (Context=100, MCP=200, LSP=300, Todo=400, Files=500). |
| `slot` | `"sidebar_content"` | Sidebar slot to render into (stacking — additive). |
| `metric` | `"output"` | Headline metric: `"output"` or `"generated"` (output + reasoning). |
| `detail` | `"full"` | `"full"`, `"compact"`, or `"minimal"` (header + sparkline only). |
| `windowMs` | `3000` | Trailing window for the live rate. |
| `pollMs` | `250` | Live re-sample cadence (sparkline animation + decay). |
| `sparkWidth` | `24` | Sparkline width in cells. |
| `seriesLength` | `40` | Sparkline history length. |
| `showSession` | `true` | Show the session aggregate lines. |
| `showCost` | `true` | Include cost in the totals line. |
| `showCache` | `false` | Include cache-read tokens in the totals line. |
| `icon` / `label` / `unit` | `""` / `"TPS"` / `"tok/s"` | Header text (empty `icon` = no glyph; set e.g. `"⚡"` to add one). |
| `colors` | theme | `{ tone: "#hex" }` overrides for tones `header｜accent｜value｜good｜warn｜muted｜label`. |

Environment overrides (handy for quick toggles):
`OPENCODE_TPS_METER_DISABLE=1`, `OPENCODE_TPS_METER_METRIC=generated`,
`OPENCODE_TPS_METER_DETAIL=compact`, `OPENCODE_TPS_METER_WINDOW_MS=2000`,
`OPENCODE_TPS_METER_SLOT=sidebar_content`.

## How precise is it?

**Exact numbers** (the `last`, `avg`, `peak`, totals, and cost) come straight from OpenCode's
`AssistantMessage`: the provider's `tokens.{input,output,reasoning,cache}` and the server's
`time.{created,completed}`. No estimation is involved — these are ground truth.

**The live number** is necessarily an estimate while a message streams (providers don't report
a running token count mid-stream). The plugin makes it as accurate as possible:

1. Every `message.part.updated` event carries a streamed `delta`. We timestamp each chunk on
   arrival and convert its characters to tokens.
2. The characters→token ratio is **calibrated per model**: when a message completes, we know
   the exact token count *and* the exact characters streamed, so we update the ratio (EWMA,
   clamped to a sane range). The next message's live estimate uses the learned ratio.
3. The first chunk's arrival time gives a real **time-to-first-token**, so decode-rate excludes
   prefill latency.
4. Throughput is a **trailing-window** average (default 3s): unbiased once warm, responsive at
   the start, and it decays smoothly to zero when the stream stops — with a floor on the window
   span so the first couple of chunks can't report an absurd spike.

The moment the turn completes, the headline switches from the calibrated live estimate to the
**exact** provider figure. The session **status** is authoritative for whether a turn is still
streaming, so a finished message snaps to its exact figure immediately (no stale "live" reading
while the rate window drains).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full methodology and module map.

## Development

```bash
npm test                 # 51 unit tests over the pure core (node --test)
npm run test:coverage    # with coverage
node tools/demo.mjs       # animated terminal demo (no OpenCode needed)
node tools/demo.mjs --ci  # deterministic frames, doubles as a smoke test
npm run verify:plugin    # load the real TSX under @opentui/solid + verify wiring (needs bun)
npm run pack:check       # inspect the publishable tarball
```

The measurement core (`plugins/tps/*.js`) is plain ESM with **no** dependency on OpenCode or
any UI toolkit, so it's trivially testable. The TUI layer (`plugins/tps-meter.tsx`) is a thin
SolidJS / `@opentui/solid` adapter. See the architecture doc for how they fit together.

## Compatibility

- OpenCode with the SolidJS TUI plugin runtime (slot API + `@opentui/solid`), i.e. the
  `1.15+` plugin line. Tested against `1.17.x`.
- Node `>= 20.11` for the tooling and tests.
- Peer deps (`@opentui/solid`, `solid-js`, `@opencode-ai/plugin`) are **optional** and supplied
  by the OpenCode TUI runtime at load time.

## License

[MIT](./LICENSE) © Devin Oldenburg
