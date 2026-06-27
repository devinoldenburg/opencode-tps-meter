# opencode-tps-meter

Tokens-per-second metering for the [OpenCode](https://opencode.ai) TUI sidebar. The plugin reports generation throughput, time-to-first-token, and per-session aggregates from the live event stream. Inter-turn waits (tools, permissions, provider stalls) are excluded from the rate and reported separately.

| | |
|---|---|
| Package | [`@devinoldenburg/opencode-tps-meter`](https://www.npmjs.com/package/@devinoldenburg/opencode-tps-meter) |
| Plugin id | `opencode-tps-meter` |
| OpenCode | TUI plugin (`sidebar_content`), `@opencode-ai/plugin` ≥ 1.15 |
| Node (tooling) | ≥ 20.11 |

[![CI](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/devinoldenburg/opencode-tps-meter/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@devinoldenburg/opencode-tps-meter)](https://www.npmjs.com/package/@devinoldenburg/opencode-tps-meter)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
- [Metrics](#metrics)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

## Overview

The meter adds a **TPS** section alongside existing sidebar blocks (Context, MCP, LSP, and others). It does not remove or replace native UI. Token totals and cost remain in Context; this plugin focuses on throughput only.

Measurement uses active generation time: time between streamed token chunks, with gaps at or above a configurable threshold classified as non-generation wait. Completed assistant messages reconcile against provider token counts and per-model character-to-token calibration.

## Installation

### Standard

Install the CLI globally, run the configurator, then restart the OpenCode TUI.

```bash
npm install -g @devinoldenburg/opencode-tps-meter
opencode-tps-meter
```

The command writes or updates `tui.json` and `package.json` under your OpenCode config directory (typically `~/.config/opencode`) and installs dependencies there.

To install a specific release:

```bash
npm install -g @devinoldenburg/opencode-tps-meter@<version>
opencode-tps-meter
```

Artifacts: [npm registry](https://www.npmjs.com/package/@devinoldenburg/opencode-tps-meter) · [GitHub releases](https://github.com/devinoldenburg/opencode-tps-meter/releases)

### Project checkout

```bash
git clone https://github.com/devinoldenburg/opencode-tps-meter.git
cd opencode-tps-meter
node scripts/install.mjs --local
```

`--local` registers the checkout as a `file:` dependency in the OpenCode config tree. Additional flags: `--dir`, `--no-install`, `--dry-run`, `--uninstall`, `--print`, `--help`.

### Manual registration

In the OpenCode config directory, declare the dependency and plugin entry.

`package.json`:

```json
{
  "dependencies": {
    "@devinoldenburg/opencode-tps-meter": "latest"
  }
}
```

`tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@devinoldenburg/opencode-tps-meter/tui"]
}
```

Install and restart:

```bash
npm install
```

Optional plugin options use the tuple form:

```json
{
  "plugin": [
    ["@devinoldenburg/opencode-tps-meter/tui", { "detail": "compact", "gapMs": 1500 }]
  ]
}
```

### Removal

```bash
opencode-tps-meter --uninstall
```

Alternatively, remove the plugin and dependency entries from `tui.json` and `package.json`, then run `npm install`.

## Configuration

Options are passed as the second element of the plugin tuple in `tui.json`. Environment variables override or mirror several keys; see `plugins/tps/config.js` for the full resolver.

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Disable rendering without uninstalling |
| `detail` | `compact` | Layout: `compact`, `full`, or `minimal` |
| `metric` | `generated` | Headline basis: `generated` or `output` |
| `gapMs` | `1500` | Minimum inter-chunk gap (ms) treated as wait |
| `showSparkline` | `true` | Trailing rate sparkline while streaming |
| `showSession` | `true` | Session average and peak in footer |
| `showWaits` | `true` | Display excluded wait duration |
| `showTotals` | `false` | Aggregate token and message counts |
| `showCost` | `false` | Include cost in totals line |
| `order` | `150` | Sidebar section ordering |
| `pollMs` | `200` | UI refresh interval (ms) |
| `windowMs` | `3000` | Sparkline trailing window (ms) |
| `label` / `unit` | `TPS` / `tok/s` | Section label and unit suffix |

Common environment variables: `OPENCODE_TPS_METER=0`, `OPENCODE_TPS_METER_DISABLE=1`, `OPENCODE_TPS_METER_METRIC`, `OPENCODE_TPS_METER_DETAIL`, `OPENCODE_TPS_METER_GAP_MS`.

## Metrics

| Field | Definition |
|-------|------------|
| Headline rate | Tokens per second over measured active generation time for the current or last completed turn |
| TTFT | Elapsed time from turn start to first streamed token |
| Wait | Cumulative duration of gaps classified as non-generation |
| Session average | Pooled tokens divided by pooled active time across completed turns in the session |
| Sparkline | Windowed instantaneous rate for visual feedback during streaming |

End-to-end wall-clock rate is intentionally not used for the headline; it conflates decoding with tool and permission latency.

## Development

```bash
npm test
npm run verify:plugin
npm run demo
node tools/demo.mjs --ci
```

Core logic is framework-free ESM under `plugins/tps/`. The TUI entry point is `plugins/tps-meter.tsx`. Peer dependencies (`@opentui/solid`, `solid-js`, `@opencode-ai/plugin`) are supplied by the OpenCode runtime when the plugin loads.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — measurement model and module layout  
- [CHANGELOG.md](./CHANGELOG.md) — release history  
- [VERSIONING.md](./VERSIONING.md) — semver and publish process  

## License

MIT. See [LICENSE](./LICENSE).