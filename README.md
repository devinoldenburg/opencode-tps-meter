# opencode-tps-meter

A **precise tokens-per-second (TPS) meter** for the [OpenCode](https://opencode.ai) TUI sidebar.
It measures **only active token generation** — how fast the model actually emits tokens — and is
blind to everything OpenCode waits for inside a turn (tool calls, permission prompts, provider
stalls). It shows nothing OpenCode's native sidebar already shows (no token totals, no cost) and
replaces none of its sections.

[![CI](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![OpenCode plugin](https://img.shields.io/badge/OpenCode-TUI%20plugin-7c5cff.svg)](https://opencode.ai)
![node >= 20.11](https://img.shields.io/badge/node-%3E%3D20.11-3c873a.svg)

```text
streaming, mid tool call           after the turn completes
TPS  192 tok/s                     TPS  192 tok/s
██▇▇▆▆▅▅▄▄▃▃▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁   →   last 192 tok/s  ttft 618ms · −3.8s wait
now  peak 198 tok/s · −3.8s wait    avg  192 tok/s  peak 192

the headline TPS holds steady across the tool call; the sparkline dips because
no tokens are flowing — and the 3.8s the tool took is excluded, not counted.
```

> Try it right now without OpenCode: `node tools/demo.mjs` (animated) or `node tools/demo.mjs --ci`.

---

## Why another meter?

OpenCode's native Context section already shows token **totals**, **% context**, and **cost**.
This plugin deliberately shows none of those — it answers a different question, **how fast?**,
and answers it precisely, distinguishing things that are usually conflated:

| Measurement | What it means | How it's measured |
|---|---|---|
| **Generation TPS** | How fast the model emits tokens, excluding every wait | tokens ÷ **active-generation time** — the summed gaps *between* streamed tokens, minus any gap big enough to be a tool call / wait |
| **TTFT** | Time-to-first-token (prefill / queue latency) | wall-clock from request start to the first streamed token |
| **Excluded wait** | Time the turn spent on tools / waiting (not generation) | summed gaps at/above the threshold — surfaced as `−Ns wait`, never in the rate |
| **End-to-end TPS** | What you'd naively measure (and why it's misleading) | `output ÷ (completed − created)` — includes all the waits |
| **Session avg** | Combined speed across the session | **pooled** (Σtokens ÷ Σactive-time), not a naive mean of rates |

The key idea: a turn's wall-clock includes tool execution and waits, so `tokens ÷ wall-clock`
*understates* generation speed — often by 3–4×. This meter times the **stream itself**, so a
4-second tool call in the middle of a turn is invisible to the TPS. See
[Precision](#how-precise-is-it) for the exact method.

## Features

- **Pure generation TPS** — measures active token-emission time only; tool calls, permission
  waits, and stalls are excluded (and surfaced separately as `−Ns wait`).
- **Live + exact, consistent** — the live headline is the in-flight message's active-generation
  rate; when the turn completes it locks to the provider's exact token count over the same
  measured time, so the number doesn't jump.
- **Measured TTFT** and a sparkline that dips during a tool call while the headline holds steady.
- **No native duplication** — token totals and cost (shown by OpenCode's Context section) are off
  by default; you see throughput, not numbers you already have.
- **Self-calibrating** characters→token ratio, learned per model from each completed message's
  exact token count, so the live estimate tracks the real tokenizer.
- **Additive** — renders into the stacking `sidebar_content` slot, so your Context / MCP / LSP /
  Todo / Files sections stay exactly where they are.
- **Theme-aware** colors with per-tone overrides; **crash-proof** (any API drift renders nothing).
- **Measured** — 62 unit + integration tests over a pure, framework-free core, including a
  server-stream simulation that proves the tool wait is excluded to the token.

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
    ["opencode-tps-meter", { "metric": "output", "gapMs": 1000, "detail": "compact" }]
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `enabled` | `true` | Set `false` to disable without uninstalling. |
| `order` | `150` | Position among sidebar sections (Context=100, MCP=200, LSP=300, Todo=400, Files=500). |
| `slot` | `"sidebar_content"` | Sidebar slot to render into (stacking — additive). |
| `metric` | `"generated"` | Headline metric: `"generated"` (output + reasoning) or `"output"`. |
| `gapMs` | `1500` | Inter-token gap at/above which generation is treated as paused (tool/wait) and **excluded** from TPS. |
| `detail` | `"full"` | `"full"`, `"compact"`, or `"minimal"` (header + sparkline only). |
| `windowMs` | `3000` | Trailing window for the live **sparkline** rate (the headline uses active-gen time, not this). |
| `pollMs` | `250` | Live re-sample cadence (sparkline animation + decay). |
| `sparkWidth` | `24` | Sparkline width in cells. |
| `seriesLength` | `40` | Sparkline history length. |
| `showWaits` | `true` | Surface excluded tool/wait time as `−Ns wait`. |
| `showSession` | `true` | Show the session average + peak line. |
| `showTotals` | `false` | Add a `Σ tokens · msgs` line. **Off** — OpenCode's Context section already shows tokens. |
| `showCost` | `false` | Add cost to the totals line. **Off** — native Context already shows cost. |
| `showCache` | `false` | Add cache-read tokens to the totals line. |
| `icon` / `label` / `unit` | `""` / `"TPS"` / `"tok/s"` | Header text (empty `icon` = no glyph; set e.g. `"⚡"` to add one). |
| `colors` | theme | `{ tone: "#hex" }` overrides for tones `header｜accent｜value｜good｜warn｜muted｜label`. |

Environment overrides (handy for quick toggles):
`OPENCODE_TPS_METER_DISABLE=1`, `OPENCODE_TPS_METER_METRIC=output`,
`OPENCODE_TPS_METER_DETAIL=compact`, `OPENCODE_TPS_METER_GAP_MS=1000`,
`OPENCODE_TPS_METER_WINDOW_MS=2000`, `OPENCODE_TPS_METER_SLOT=sidebar_content`.

## How precise is it?

TPS here means **tokens ÷ active-generation time** — the time the model spent actually emitting
tokens, and nothing else.

**Why not wall-clock?** A turn's `completed − created` (and even `completed − firstToken`)
includes everything OpenCode waits for *inside* the turn: tool execution, permission prompts,
provider stalls, and the re-prefill before the model resumes after a tool. Dividing tokens by
that understates generation speed, often by 3–4×. So we don't time the turn — we time the
**stream**.

1. Every `message.part.updated` event carries a streamed `delta`. Each chunk is timestamped on
   arrival. **Active-generation time** is the sum of the gaps *between* consecutive chunks — but
   only gaps below `gapMs` (default 1500 ms). A larger gap means the model stopped emitting (a
   tool call / wait), so it is **excluded** and reported separately as `−Ns wait`. Active
   generation gaps are tiny (models emit many tokens/sec); tool calls are seconds — the threshold
   sits comfortably between, so real generation is never excluded and waits always are.
2. The first chunk of each burst (the start, and the first chunk after each excluded gap) was
   decoded during prefill/resume — *before* the window we time — so its "prime" tokens are
   excluded from the numerator. With that, a constant-rate stream measures its true rate **to the
   token**, no matter how many tool calls interrupt it.
3. The first chunk's arrival gives a real **time-to-first-token**.
4. The characters→token ratio is **calibrated per model** from each completed message's exact
   token count, so the live estimate tracks the real tokenizer.
5. When the turn completes, the headline locks to the provider's **exact** token count over the
   same measured active time (prime-corrected identically), so the number doesn't jump. Session
   **status** is authoritative for "is it still streaming", so a finished turn snaps to its exact
   figure immediately.

This is verified by a **server-stream simulation** (`tests/gen.test.mjs`,
`tests/integration.test.mjs`): a 200 tok/s stream interrupted by two 5-second tool calls is
measured as exactly 200 tok/s, while a naive wall-clock reading would show ~46. Run
`node tools/demo.mjs` to watch the headline hold steady across a tool call while the sparkline
dips.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full methodology and module map.

## Development

```bash
npm test                 # 62 unit + integration tests over the pure core (node --test)
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
