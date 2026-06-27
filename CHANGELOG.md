# Changelog

All notable changes to **`@devinoldenburg/opencode-tps-meter`** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (see [`VERSIONING.md`](./VERSIONING.md)).

## [Unreleased]

## [0.1.6] — 2026-06-27

### Fixed

- **Session handling (TUI).** Sidebar slot renderers now resolve the active session from
  `ctx.session_id`, `sessionID` / `sessionId` on ctx or slot props, `route.params`, and
  `session.current()` / `session.active()` — fixing meters that never mounted when OpenCode
  passed only `sessionID` or routed session ids.
- **Event coverage.** Subscribes to `message.part.delta`, `session.next.text.delta`,
  `session.next.reasoning.delta`, and related `session.next.*` events; normalizes
  `messageID`, `partID`, and delta payload shapes so live TPS is not dropped on newer builds.
- **Session summary fallback.** When `session.messages()` is empty, aggregates from
  `session.get()` token totals and polls token growth for live throughput (TUI runtimes
  without per-message arrays).
- **Observed messages cache.** `message.updated` assistant payloads are merged into the
  view model so history survives partial state APIs.

### Added

- **`plugins/tps/session.js`** — pure session-id and event-payload helpers (unit-tested).
- **Plugin verify** — asserts session id resolution from ctx, props, and route fallback.

## [0.1.5] — 2026-06-27

### Changed

- **Native-style compact sidebar.** Section title on its own line, rate on the next (like
  Context), muted sparkline, detail line with `TTFT` / `Wait` / `Peak` labels and spaced
  separators. Removed extra top padding; default poll 200ms for smoother live updates.
- **Sparkline** uses a dedicated muted tone; default width 16.

## [0.1.4] — 2026-06-27

### Changed

- **Default UI (`detail: compact`).** Sidebar shows a bold headline plus one muted footer
  (TTFT, excluded wait, peak/avg only when they differ from the headline). No redundant
  `last`/`avg` rows; sparkline appears while streaming only.
- **Display precision.** `fmtRate` keeps one decimal from 100 tok/s and two below 10;
  k-format uses two decimals. Generation math unchanged — only how numbers are shown.
- **Tighter sparkline** default width 18 (was 24).

## [0.1.3] — 2026-06-27

### Fixed

- **GenerationTimer TTFT.** `firstAt` is set only when a chunk carries a positive token count,
  so a tokenless initial delta (e.g. zero-length `message.part.updated`) no longer anchors
  time-to-first-token 500 ms early.
- **TUI plugin init.** Registration failures emit `process.emitWarning` (code
  `OPENCODE_TPS_METER_INIT`) or `console.warn` instead of failing silently.

### Changed

- **CI / release workflows.** Bump `actions/checkout` to v7, `actions/setup-node` to v6, and
  `softprops/action-gh-release` to v3.

## [0.1.2] — 2026-06-21

### Fixed

- **RateMeter precision.** `smooth()` now seeds from the first measurable instantaneous rate
  instead of zero, eliminating cold-start under-reporting. Non-positive and non-finite deltas
  are ignored but still refresh `_lastAt` for accurate `active()` state. Non-monotonic
  (backwards) timestamps are rejected. The internal `_windowSum` invariant is now guarded
  with an explicit error throw instead of a silent reset. The `active()` boundary is exclusive
  (`< windowMs`), removing a 1 ms false positive at exactly the window boundary. `rate()` span
  uses the true first-sample timestamp rather than `_startedAt`, improving precision for streams
  with multiple deltas.
- **GenerationTimer fixes.** Zero-token deltas no longer consume the post-gap prime marker via a
  `_pendingPrime` flag, so the first real token after a tool-call gap is correctly classified as
  a resume chunk. Non-monotonic timestamps are rejected. `setTokens()` now scales `_primeTokens`
  proportionally when the provider's exact token count differs from the streamed estimate, keeping
  `decodeTokens` and `tps()` truly exact at completion.
- **Formatter correctness.** `fmtRate` now crosses into "k" format at `≥ 999.5` instead of
  `≥ 1000`, so values like 999.7 display as `"1k"` rather than `"1000"`. `fmtTokens` guards
  negative inputs and returns `"0"`. `fmtMs` rounds to the nearest second before splitting into
  minutes, eliminating `"Xm60s"` overflow at minute boundaries. `fmtCost` returns `"$0"` for
  negative and zero values. `sparkline` clamps `max` to at least `min`, handling inverted
  min/max pairs.
- **View layer.** The empty-segment filter now also catches `text: ""`, removing unnecessary
  empty `<span>` DOM nodes. The stale-copy `DEFAULTS` object in `view.js` is replaced with a
  shared import from `config.js`, so display config can no longer drift out of sync. Streaming
  messages with history now show both the live-detail and last-message rows instead of one
  hiding the other. The sparkline reappears at turn completion (idle state).
- **Config resolution.** `order` now has a `0` floor clamp, matching all other numeric options.
  Boolean options (`showSparkline`, `showSession`, `showWaits`, `showTotals`, `showCost`,
  `showCache`) use a unified `bool()` helper with consistent opt-in/opt-out semantics and
  environment-variable overrides. Named constants (`MIN_ORDER`, `MIN_POLL_MS`, …) replace
  inline magic numbers. `OPENCODE_TPS_METER` empty string now disables (added to `isFalsy`).
  `isTruthy` handles `"yes"`/`"on"`/`"1"` for `OPENCODE_TPS_METER_DISABLE`. `options.enabled=true`
  now overrides the env disable flag. `num()` options correctly fall back to environment
  variables when the option is omitted or nullish, rather than treating explicit `0` as unset.
  The metric env variable (`OPENCODE_TPS_METER_METRIC`) can now switch back to `"generated"`
  when the option is set to `"output"`.
- **TUI plugin reliability.** The per-session `partLen` map now tracks `{ length, messageID }`
  per part and is cleaned up on `message.removed`, preventing memory leaks. The chars-per-token
  calibration ratio is now per-model (`ratioByModel`) rather than a single session-global
  variable, fixing cross-model calibration corruption. Calibration falls back to partLen state
  when `state.part()` returns empty for completed messages. `sessionID` comparisons use string
  coercion to avoid type-mismatch silent event drops. `onCleanup` is registered before
  `setInterval`, so a component construction throw no longer orphans the interval timer.
  TypeScript annotations added throughout. Delta-fallback no longer inflates token count on
  first sight of already-large part text.
- **Installer safety and correctness.** Malformed existing `tui.json`/`package.json` now causes
  a clear error exit instead of silent overwrite. Rotating backup files (`file.bak`,
  `file.bak.1`, …) replace the single `.bak` that was silently overwritten. `--dir` followed by
  the next flag now correctly errors instead of capturing the flag name as a directory. The
  `--help` text is a static constant rather than a fragile source-line-range parse. Tuple-format
  plugin entries `["@devinoldenburg/opencode-tps-meter", { … }]` are now detected and migrated
  to `@devinoldenburg/opencode-tps-meter/tui` preserving their options. `--uninstall` now also
  removes the package dependency from `package.json`. A failed `npm install` now sets a non-zero
  exit code and returns rather than printing a misleading success message.
- **Package metadata and exports.** The package root (`"."`) now exports `plugins/tps/root.js`,
  which re-exports all core named exports AND provides a `default { id, tui }` TUI plugin shim,
  so existing OpenCode configs using `["@devinoldenburg/opencode-tps-meter"]` continue to work.
  The explicit TUI path `"./tui"` is unchanged. TypeScript declaration file (`index.d.ts`) added
  for the `"./core"` surface. Peer dependency ranges tightened from `"*"` to
  `@opentui/solid@>=0.4.1 <1` and `solid-js@>=1.9.12 <2`. `package-lock.json` is now committed
  for reproducible development/CI installs; the ignore rule was removed. `NOTES.md` is excluded
  from the published npm tarball.
- **Calibration robustness.** `MIN_RATIO` lowered from `1.2` to `0.25` for CJK and other
  high-density languages. `calibrateRatio` with `alpha=0` now emits a diagnostic warning rather
  than silently freezing calibration. The `n0()` fallback no longer passes negative numbers
  through (returns `0` instead). `aggregate` now surfaces `decodeSource` metadata.
- **CI, release, and tooling.** The `test` job now runs on `ubuntu-latest`, `macos-latest`, and
  `windows-latest` with Node 20.11, 20, 22, and 24. A TypeScript check step (`npx tsc --noEmit`)
  was added. `npm ci` runs before tests. `pull_request` triggers on all branches. The Bun
  plugin-verification job and release workflow now both run `npm run verify:plugin` (with Bun
  setup in release). Release publishes prerelease versions under the `next` tag. Dependabot
  configuration added for npm and GitHub Actions weekly updates. `.gitignore` covers `*.tgz`,
  `*.bak`, and `*.bak.*`.
- **Demo and verification tools.** `demo.mjs` now feeds pre-computed schedule token counts
  directly instead of round-tripping through `tokensFromChars`, eliminating floating-point
  drift. The `--ci` tool-gap detection uses the actual `TOOL_GAP` constant. The CI smoke-test
  assertion checks the first line starts with `"TPS"` instead of a fragile `.includes` check.
  The terminal cursor is restored on crash. `verify-plugin.mjs` wraps the empty-session renderer
  call in a try/catch and uses an exact string match for the expected "No renderer found" error.
  `install-peers.mjs` version-pins peer packages and copies transitive dependencies without
  overwriting existing packages; the temporary directory is cleaned up.

## [0.1.1] — 2026-06-20

### Fixed

- **Documentation accuracy pass.** Removed a duplicated "Calibration" section in
  `ARCHITECTURE.md`; corrected the public `exports` key notation (`.` not `./`) in
  `VERSIONING.md`; documented the previously-undocumented `showSparkline` option and the
  `OPENCODE_TPS_METER=0` disable form in `README.md`; added `--help` to the documented
  installer flags (README + CHANGELOG); updated the internal `NOTES.md` to reflect the public,
  published repository.
- Removed a dead, never-read `--global` flag branch from `scripts/install.mjs` (no behavior
  change).

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
  `--local` / `--dir` / `--no-install` / `--dry-run` / `--uninstall` / `--print` / `--help` modes.
- **Pure, framework-free core** (`plugins/tps/*.js`) with **62 unit + integration tests**
  asserting hand-computed exact expectations.
- **Tooling**: a runnable terminal demo (`tools/demo.mjs`, with a tool-call gap and a
  deterministic `--ci` mode), a Bun-based plugin verifier (`tools/verify-plugin.mjs`), and a peer
  installer (`tools/install-peers.mjs`).

[Unreleased]: https://github.com/devinoldenburg/opencode-tps-meter/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/devinoldenburg/opencode-tps-meter/releases/tag/v0.1.2
[0.1.1]: https://github.com/devinoldenburg/opencode-tps-meter/releases/tag/v0.1.1
[0.1.0]: https://github.com/devinoldenburg/opencode-tps-meter/releases/tag/v0.1.0
