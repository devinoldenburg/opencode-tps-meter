#!/usr/bin/env bun
/**
 * verify-plugin.mjs — a runtime smoke test for the TUI plugin module itself.
 *
 * Unlike the node unit tests (which exercise the pure core), this loads the real
 * TSX under Bun with the actual `@opentui/solid` + `solid-js` peer runtime and
 * checks that:
 *   - every import resolves (catches a wrong solid-js / opentui import name),
 *   - the default export has the expected `{ id, tui }` shape,
 *   - `tui(api)` registers a renderer into the stacking `sidebar_content` slot
 *     at the configured order, given a minimal mock API.
 *
 * Run with Bun (the TUI runtime transpiles TSX): `bun tools/verify-plugin.mjs`.
 * If the peer deps aren't installed it skips cleanly (exit 0) so it never breaks
 * a plain `node`/CI run.
 */

// Peer runtime present? If not, skip — this check is bun + peer-deps only.
try {
  await import("@opentui/solid");
  await import("solid-js");
} catch {
  console.log("⏭  skip: @opentui/solid / solid-js not installed (run `npm i --no-save solid-js @opentui/solid` then `bun tools/verify-plugin.mjs`)");
  process.exit(0);
}

const mod = await import("../plugins/tps-meter.tsx");
const plugin = mod.default;

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
};

assert(plugin && typeof plugin === "object", "default export is an object");
assert(plugin.id === "opencode-tps-meter", "id is opencode-tps-meter");
assert(typeof plugin.tui === "function", "tui is a function");

// Minimal mock of the TuiPluginApi surface the plugin touches at registration.
let registered = null;
const mockApi = {
  theme: { current: { text: "#fff", accent: "#0ff", success: "#0f0", warning: "#ff0", textMuted: "#888" } },
  event: { on: () => () => {} },
  state: {
    session: { messages: () => [], status: () => ({ type: "idle" }) },
    part: () => [],
  },
  slots: {
    register(spec) {
      registered = spec;
      return "mock-registration-id";
    },
  },
};

await plugin.tui(mockApi, { order: 150 });

assert(registered, "tui() called slots.register");
assert(registered.order === 150, `registered at order 150 (got ${registered && registered.order})`);
assert(
  registered.slots && typeof registered.slots.sidebar_content === "function",
  "registered a sidebar_content renderer",
);

// The slot renderer must no-op (return undefined) when there's no session id.
const empty = registered.slots.sidebar_content({}, {});
assert(empty === undefined, "sidebar_content returns undefined without a session_id");

// Build the component for a real session. We have no live terminal renderer in a
// headless harness, so opentui's intrinsic <box>/<text> creation legitimately
// errors with "No renderer found" — reaching that point proves TpsView's whole
// body ran (config, RateMeter, event wiring, memo, JSX construction) with every
// import resolved. Any *other* error is a real failure.
try {
  registered.slots.sidebar_content({}, { session_id: "ses_demo" });
  console.log("✓ sidebar_content built a component for a session");
} catch (err) {
  const msg = String(err?.message || err);
  if (/renderer/i.test(msg)) {
    console.log("✓ sidebar_content ran to JSX construction (no live renderer in headless harness — expected)");
  } else {
    console.error("✗ sidebar_content threw an unexpected error for a real session:", err);
    process.exit(1);
  }
}

console.log("\n✅ plugin module verified under the @opentui/solid runtime");
