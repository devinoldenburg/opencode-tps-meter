import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSessionID,
  messageInfo,
  eventSessionID,
  deltaTextLength,
  generatedTokens,
  summaryMessage,
} from "../plugins/tps/session.js";

test("resolveSessionID prefers ctx.session_id", () => {
  assert.equal(resolveSessionID({ session_id: "a" }, { sessionID: "b" }, {}), "a");
});

test("resolveSessionID accepts sessionID and sessionId variants", () => {
  assert.equal(resolveSessionID({}, { sessionID: "sid-1" }, {}), "sid-1");
  assert.equal(resolveSessionID({ sessionId: "sid-2" }, {}, {}), "sid-2");
});

test("resolveSessionID falls back to route.params", () => {
  const api = { route: { current: { params: { session_id: "from-route" } } } };
  assert.equal(resolveSessionID({}, {}, api), "from-route");
});

test("resolveSessionID falls back to session.current()", () => {
  const api = { state: { session: { current: () => ({ id: "cur-ses" }) } } };
  assert.equal(resolveSessionID({}, {}, api), "cur-ses");
});

test("messageInfo unwraps nested info", () => {
  assert.deepEqual(messageInfo({ info: { id: "m1", role: "assistant" } }), { id: "m1", role: "assistant" });
});

test("eventSessionID reads part and property aliases", () => {
  assert.equal(eventSessionID({ session_id: "e1" }, {}), "e1");
  assert.equal(eventSessionID({}, { sessionID: "p1" }), "p1");
});

test("deltaTextLength handles string and object deltas", () => {
  assert.equal(deltaTextLength("abc"), 3);
  assert.equal(deltaTextLength({ text: "xy" }), 2);
  assert.equal(deltaTextLength({ content: "z" }), 1);
});

test("summaryMessage builds assistant stats from session summary", () => {
  const msg = summaryMessage(
    {
      id: "ses-9",
      tokens: { output: 100, reasoning: 5, input: 1 },
      time: { created: 1, updated: 2000 },
      model: { id: "gpt", providerID: "openai" },
    },
    "fallback",
  );
  assert.equal(msg.role, "assistant");
  assert.equal(msg.tokens.output, 100);
  assert.equal(generatedTokens(msg.tokens), 105);
});