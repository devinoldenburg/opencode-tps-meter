import test from "node:test";
import assert from "node:assert/strict";
import { eventBelongsToView, removalMessageID, removalSessionID } from "../plugins/tps/session.js";
import { parsePartDelta, partCharsAdded, liveHeadlineTps } from "../plugins/tps/adapter.js";

test("eventBelongsToView rejects unscoped events by default", () => {
  assert.equal(eventBelongsToView("ses-a", undefined), false);
  assert.equal(eventBelongsToView("ses-a", null), false);
});

test("eventBelongsToView matches session id with string coercion", () => {
  assert.equal(eventBelongsToView("ses-a", "ses-a"), true);
  assert.equal(eventBelongsToView("ses-a", "ses-b"), false);
});

test("parsePartDelta drops other sessions", () => {
  const r = parsePartDelta("mine", {
    type: "message.part.updated",
    properties: { part: { sessionID: "other", type: "text", text: "hi", delta: "hi" } },
  });
  assert.equal(r.ok, false);
});

test("parsePartDelta accepts matching session and extracts delta", () => {
  const r = parsePartDelta("mine", {
    type: "message.part.updated",
    properties: {
      part: { sessionID: "mine", type: "text", messageID: "m1", id: "p1", text: "hello" },
      delta: "lo",
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.deltaLen, 2);
  assert.equal(r.messageID, "m1");
});

test("partCharsAdded prefers explicit delta length", () => {
  assert.equal(partCharsAdded(10, 3, { length: 5 }), 3);
  assert.equal(partCharsAdded(10, 0, { length: 7 }), 3);
});

test("liveHeadlineTps prefers generation timer", () => {
  const tps = liveHeadlineTps({ tps: () => 42 }, { smooth: () => 10, active: () => true }, 0);
  assert.equal(tps, 42);
});

test("liveHeadlineTps falls back to smooth window when idle gen", () => {
  const tps = liveHeadlineTps(
    { tps: () => null },
    { smooth: () => 88, active: () => true },
    1000,
  );
  assert.equal(tps, 88);
});

test("removalSessionID and removalMessageID", () => {
  assert.equal(removalMessageID({ messageID: "x" }), "x");
  assert.equal(removalSessionID({ session_id: "s1" }), "s1");
});