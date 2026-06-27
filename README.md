# opencode-tps-meter

**Live tokens-per-second in the OpenCode sidebar** — real generation speed, time-to-first-token, and session averages. Tool calls and permission waits are excluded from the rate (shown separately), so the number reflects how fast the model actually decodes, not how long the turn took on the wall clock.

[![CI](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@devinoldenburg/opencode-tps-meter)](https://www.npmjs.com/package/@devinoldenburg/opencode-tps-meter)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

```text
TPS
192.3 tok/s
▇▆▅▄▃▂▁▁▁▁▁▁▁▁▁▁
Peak 198.1  ·  Wait 3.8s     ← wait is not counted in tok/s
```

Adds a **TPS** block next to Context / MCP / LSP — it does not replace native sections or duplicate token totals and cost (those stay in Context).

---

## Download & install

Published on npm as **`@devinoldenburg/opencode-tps-meter`** (scoped). The global command is still **`opencode-tps-meter`**.

### 1. Recommended — npm + installer

```bash
npm install -g @devinoldenburg/opencode-tps-meter
opencode-tps-meter
```

The installer updates `~/.config/opencode` (or your OpenCode config dir): `tui.json`, `package.json`, and runs `npm install` there.

**Restart the OpenCode TUI.** You should see **TPS** in the sidebar while a session is active.

Pin a version:

```bash
npm install -g @devinoldenburg/opencode-tps-meter@0.1.7
opencode-tps-meter
```

Latest release: [GitHub Releases](https://github.com/devinoldenburg/opencode-tps-meter/releases) · [npm](https://www.npmjs.com/package/@devinoldenburg/opencode-tps-meter)

### 2. One-off without global install

From your OpenCode config directory (usually `~/.config/opencode`):

```bash
cd ~/.config/opencode
npm install @devinoldenburg/opencode-tps-meter@latest
```

Add the TUI plugin (see [Manual setup](#manual-setup) below), then `npm install` again if needed and restart the TUI.

### 3. From source (clone)

```bash
git clone https://github.com/devinoldenburg/opencode-tps-meter.git
cd opencode-tps-meter
node scripts/install.mjs --local
```

`--local` links this checkout into your OpenCode config via a `file:` dependency (good for hacking on the plugin).

Other installer flags: `--dir <path>`, `--no-install`, `--dry-run`, `--uninstall`, `--print`, `--help`.

### 4. Manual setup

In your OpenCode config folder:

**`tui.json`**

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@devinoldenburg/opencode-tps-meter/tui"]
}
```

With options:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    ["@devinoldenburg/opencode-tps-meter/tui", { "detail": "compact", "gapMs": 1500 }]
  ]
}
```

**`package.json`**

```jsonc
{
  "dependencies": {
    "@devinoldenburg/opencode-tps-meter": "latest"
  }
}
```

Then:

```bash
cd ~/.config/opencode   # or your config path
npm install
```

Restart the OpenCode TUI.

### Uninstall

```bash
opencode-tps-meter --uninstall
```

Or remove the plugin entry from `tui.json` and the dependency from `package.json`, then `npm install`.

---

## What you get

| Reading | Meaning |
|--------|---------|
| **Headline tok/s** | Active generation speed (stream timing, not full turn wall clock) |
| **TTFT** | Time to first streamed token |
| **Wait** | Tool / permission / stall time excluded from the rate |
| **Session avg** | Pooled over the session (Σ tokens ÷ Σ active time) |
| **Sparkline** | Recent windowed rate while streaming (texture only) |

When a turn finishes, the headline locks to the provider’s exact token count over the same measured active time, so it should not jump arbitrarily.

---

## Configuration

Options go in the `["@devinoldenburg/opencode-tps-meter/tui", { … }]` tuple in `tui.json`.

| Option | Default | Notes |
|--------|---------|--------|
| `enabled` | `true` | `false` disables without uninstalling |
| `detail` | `"compact"` | `"compact"` · `"full"` · `"minimal"` |
| `metric` | `"generated"` | `"generated"` (output + reasoning) or `"output"` |
| `gapMs` | `1500` | Gaps ≥ this between chunks count as wait, not generation |
| `showSparkline` | `true` | Trailing spark while streaming |
| `showSession` | `true` | Session average / peak in footer |
| `showWaits` | `true` | Show excluded wait time |
| `showTotals` / `showCost` | `false` | Off by default (Context already shows these) |
| `order` | `150` | Sidebar order (Context ≈ 100) |
| `pollMs` / `windowMs` | `200` / `3000` | Live refresh / spark window |
| `icon` / `label` / `unit` | `""` / `TPS` / `tok/s` | Header text |

**Environment (quick toggles):** `OPENCODE_TPS_METER=0`, `OPENCODE_TPS_METER_DISABLE=1`, `OPENCODE_TPS_METER_METRIC=output`, `OPENCODE_TPS_METER_DETAIL=compact`, `OPENCODE_TPS_METER_GAP_MS=1000`, and others — see `plugins/tps/config.js`.

---

## Try without OpenCode

```bash
git clone https://github.com/devinoldenburg/opencode-tps-meter.git
cd opencode-tps-meter
npm install
node tools/demo.mjs        # animated demo
node tools/demo.mjs --ci  # deterministic smoke test
```

---

## How it works (short)

1. Stream deltas from OpenCode events are timestamped; gaps larger than `gapMs` are treated as waits.
2. Live rate uses **active-generation time**; completed turns use provider token counts and recalibrate chars→tokens per model.
3. Pure math lives in `plugins/tps/*.js` (unit-tested); `plugins/tps-meter.tsx` is the thin TUI adapter.

Details: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · precision notes in previous docs / `CHANGELOG.md`.

---

## Development

```bash
npm test              # 90+ tests (node --test)
npm run verify:plugin # TSX smoke test (needs bun)
npm run demo
npm run pack:check
```

**Requires:** Node ≥ 20.11, OpenCode TUI with plugin slots (`@opencode-ai/plugin` 1.15+, tested on 1.17.x). Peer deps are provided by the OpenCode runtime at load time.

---

## Releases

[Semantic Versioning](./VERSIONING.md) · [Changelog](./CHANGELOG.md) · tags `v*` publish to npm via GitHub Actions.

---

## License

[MIT](./LICENSE) © Devin Oldenburg