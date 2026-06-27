/**
 * adapter.js — pure event → token-delta decisions for the TUI layer (unit-tested).
 */

import { deltaTextLength, eventSessionID, eventBelongsToView } from "./session.js";

/**
 * @param {string} viewSessionID
 * @param {Record<string, unknown>} event
 * @returns {{ ok: boolean, added: number, messageID?: string, partID?: string, partType?: string }}
 */
export function parsePartDelta(viewSessionID, event) {
  const ev = event?.properties && typeof event.properties === "object" ? event.properties : {};
  const part = ev.part && typeof ev.part === "object" ? ev.part : {};
  const evSession = eventSessionID(ev, part);
  if (!eventBelongsToView(viewSessionID, evSession)) {
    return { ok: false, added: 0 };
  }

  const eventType = event?.type || "";
  const partType =
    part.type ??
    ev.type ??
    ev.partType ??
    (String(eventType).includes(".reasoning.") ? "reasoning" : String(eventType).includes(".text.") ? "text" : undefined);
  if (partType && partType !== "text" && partType !== "reasoning") {
    return { ok: false, added: 0 };
  }

  const messageID =
    part.messageID ??
    ev.messageID ??
    ev.message_id ??
    ev.assistantMessageID ??
    (ev.info && typeof ev.info === "object" ? ev.info.id : undefined) ??
    `${viewSessionID}:live`;
  const partID =
    part.id ??
    ev.partID ??
    ev.part_id ??
    ev.textID ??
    ev.reasoningID ??
    ev.id ??
    `${messageID}:part`;

  const fullText =
    typeof part.text === "string"
      ? part.text
      : typeof ev.text === "string"
        ? ev.text
        : typeof ev.content === "string"
          ? ev.content
          : "";
  const full = fullText.length;
  const deltaLen = deltaTextLength(ev.delta ?? ev.textDelta ?? ev.contentDelta);

  return {
    ok: true,
    messageID: String(messageID),
    partID: String(partID),
    partType,
    full,
    deltaLen,
  };
}

/**
 * @param {number} full
 * @param {number} deltaLen
 * @param {{ length: number }|undefined} prev
 */
export function partCharsAdded(full, deltaLen, prev) {
  if (deltaLen > 0) return deltaLen;
  if (prev) return Math.max(0, full - prev.length);
  return full;
}

/**
 * Live headline TPS: active-generation rate first, then smoothed window (spark texture).
 *
 * @param {{ tps: () => number|null }|null} inflight
 * @param {{ smooth: (n: number) => number, active: (n: number) => boolean }} meter
 * @param {number} now
 */
export function liveHeadlineTps(inflight, meter, now) {
  if (inflight) {
    const gen = inflight.tps();
    if (gen !== null && gen !== undefined && Number.isFinite(gen) && gen > 0) return gen;
  }
  if (meter.active(now)) {
    const sm = meter.smooth(now);
    if (Number.isFinite(sm) && sm > 0) return sm;
  }
  return null;
}