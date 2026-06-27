# Versioning

This project follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Given a version `MAJOR.MINOR.PATCH`:

- **MAJOR** — incompatible / breaking changes (e.g. a config option is removed or renamed, the
  OpenCode plugin contract changes, the published `exports` map changes in a breaking way).
- **MINOR** — new, backwards-compatible features (a new config option, a new sidebar detail
  level, a new exported core helper). Notable changes are documented in
  [`CHANGELOG.md`](./CHANGELOG.md) under an `Added` or `Changed` heading.
- **PATCH** — backwards-compatible bug fixes and refinements (measurement precision fixes,
  theme tweaks, crash-proofing against API drift).

Anything in the public `exports` surface (`.`, `./tui`, `./core`, `./package.json`) is covered
by this policy. Internal modules (`plugins/tps/*.js` beyond the re-exports in `./core`,
`tools/*`, `scripts/*`) are not part of the stability contract and may change at any time.

## Pre-1.0

While the package is `0.x`, the rules above apply with the common pre-1.0 relaxation:
**MINOR** may include changes that would be considered breaking after 1.0. Downgrades within
`0.x` are still avoided whenever possible, and every notable change is recorded in the changelog.

## The npm package name

The package is published as **`@devinoldenburg/opencode-tps-meter`** (scoped). The unscoped name
`opencode-tps-meter` is already owned on the npm registry by an unrelated package
(`ChiR24/opencode-tps-meter`), so this project ships under the author's scope. The OpenCode
plugin **id** (`opencode-tps-meter`) and the global CLI command (`opencode-tps-meter`) are
unchanged — only the npm package name is scoped. The package is published with public access.

## Release process

Releases are cut by pushing a git tag of the form `v<version>` (e.g. `v0.1.8`). The
[`Release` workflow](./.github/workflows/release.yml) runs unit tests, TypeScript check
(`tsc --noEmit`), plugin verification (Bun), demo smoke (`--ci`), and pack check, then
publishes to npm and creates a GitHub Release (title = tag name only).

### One-time setup (maintainer)

1. Create / log in to an npm account that owns the `@devinoldenburg` scope
   (the scope is created automatically on the first scoped publish with `--access public`).
2. Create an npm **access token** (an *automation* token, or a *granular* token scoped to publish
   `@devinoldenburg/opencode-tps-meter`) and add it to the GitHub repository as the secret
   **`NPM_TOKEN`** (*Settings → Secrets and variables → Actions*).
3. Ensure the GitHub repository is **public** — npm provenance signing requires it.

### Cutting a release

1. Update `version` in [`package.json`](./package.json) and add a `CHANGELOG.md` entry under the
   new version (move items out of `[Unreleased]`).
2. Commit, then tag and push:

   ```bash
   git tag v0.X.Y
   git push origin v0.X.Y
   ```

3. The `Release` workflow publishes to npm (with provenance) and opens a GitHub Release titled
   **`vX.Y.Z` only** (no subtitle). Release notes come from generated notes + `CHANGELOG.md`.
   Confirm the new version appears at <https://www.npmjs.com/package/@devinoldenburg/opencode-tps-meter>.

### Pre-release / canary

For a pre-release (`0.X.Y-rc.0`, `0.X.Y-beta.1`, …), tag normally (`v0.X.Y-rc.0`). npm publishes
it under the `next`/`prerelease` dist-tag rather than `latest`, so it does not become the
default install.

### Rollback

npm does not allow deleting or overwriting a published version. To roll back, deprecate the
bad version and cut + publish a fresh patch:

```bash
npm deprecate @devinoldenburg/opencode-tps-meter@0.X.Y "broken — use 0.X.Z"
```
