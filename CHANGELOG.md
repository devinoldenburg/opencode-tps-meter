# Changelog

All notable changes to `opencode-tps-meter` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-20

Initial release.

### Added

- **Live TPS meter** for the OpenCode TUI sidebar: a trailing-window tokens-per-second headline
  and an animated sparkline that decays to zero when streaming stops.
- **Exact, provider-reported throughput** for the last completed message — output and
  output+reasoning rates, with **measured time-to-first-token** and decode duration (decode vs
  end-to-end windows).
- **Session aggregates** — pooled average TPS, peak, total tokens, message count, and cost.
- **Self-calibrating characters→token ratio**, learned per model from each completed message's
  exact token count, so the live estimate tracks the real tokenizer.
- **Additive rendering** into the stacking `sidebar_content` slot (order 150) — never replaces
  native sidebar sections.
- **Theme-aware colors** with per-tone overrides; configurable metric, detail level, window,
  cadence, sparkline width, and labels, via plugin options or environment variables.
- **Installer** (`scripts/install.mjs`, the package bin) — idempotent, reversible, with
  `--local` / `--dir` / `--dry-run` / `--uninstall` / `--print` modes.
- **Pure, framework-free core** (`plugins/tps/*.js`) with **51 unit tests** asserting
  hand-computed exact expectations.
- **Tooling**: a runnable terminal demo (`tools/demo.mjs`, with a deterministic `--ci` mode)
  and a Bun-based plugin verifier (`tools/verify-plugin.mjs`) that loads the real TSX under the
  `@opentui/solid` runtime.

[Unreleased]: https://github.com/devinoldenburg/opencode-tps-meter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/devinoldenburg/opencode-tps-meter/releases/tag/v0.1.0
