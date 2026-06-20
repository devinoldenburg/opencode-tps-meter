# Changelog

All notable changes to **`@devinoldenburg/opencode-tps-meter`** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see [`VERSIONING.md`](./VERSIONING.md)).

## [Unreleased]

## [0.1.0] — 2026-06-20

Initial release.

### Added

- **Pure generation TPS** — measures `tokens ÷ active-generation time`, where active time is the
  summed gaps *between* streamed tokens minus any gap large enough to be a tool call / wait
  (`gapMs`, default 1500 ms). Tool execution, permission prompts, and provider stalls are
  excluded from the rate and surfaced separately as `−Ns wait`. Prefill/resume "prime" tokens are
  excluded from the numerator, so a constant-rate stream measures its true rate to the token —
  proven by a server-stream simulation.
- **Consistent live + exact** — the live headline is the in-flight message's active-generation
  rate; on completion it locks to the provider's exact `tokens.{output,reasoning}` over the same
  measured time, so the number doesn't jump.
- **Measured time-to-first-token**, a sparkline (windowed `RateMeter`) that dips during a tool
  call while the headline holds steady, and pooled session average + peak.
- **No native duplication** — token totals and cost (shown by OpenCode's Context section) are off
  by default (`showTotals` / `showCost`); the meter shows throughput, TTFT, and excluded wait.
- **Self-calibrating characters→token ratio**, learned per model from each completed message's
  exact token count.
- **Additive rendering** into the stacking `sidebar_content` slot (order 150) — never replaces
  native sidebar sections.
- **Theme-aware colors** with per-tone overrides; configurable metric (default `generated`),
  gap threshold, detail level, sparkline, and labels, via plugin options or environment variables.
- **Installer** (`scripts/install.mjs`, the package bin) — idempotent, reversible, with
  `--local` / `--dir` / `--dry-run` / `--uninstall` / `--print` modes.
- **Pure, framework-free core** (`plugins/tps/*.js`) with **62 unit + integration tests**
  asserting hand-computed exact expectations.
- **Tooling**: a runnable terminal demo (`tools/demo.mjs`, with a tool-call gap and a
  deterministic `--ci` mode), a Bun-based plugin verifier (`tools/verify-plugin.mjs`), and a peer
  installer (`tools/install-peers.mjs`).

[Unreleased]: https://github.com/devinoldenburg/opencode-tps-meter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/devinoldenburg/opencode-tps-meter/releases/tag/v0.1.0
