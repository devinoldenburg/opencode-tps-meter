/**
 * session.js — OpenCode TUI session identity + event payload normalization.
 *
 * Sidebar slot renderers receive session ids under several keys depending on
 * OpenCode version; events likewise vary field names. Pure helpers here are
 * unit-tested so the TSX stays thin and we never drop events due to casing drift.
 */

/** @param {unknown} raw */
export function messageInfo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.info && typeof o.info === "object") return /** @type {Record<string, unknown>} */ (o.info);
  return o;
}

/**
 * Resolve the active session id for a sidebar slot render call.
 *
 * @param {Record<string, unknown>|null|undefined} ctx
 * @param {Record<string, unknown>|null|undefined} slotProps
 * @param {Record<string, unknown>|null|undefined} api
 * @returns {string|undefined}
 */
export function resolveSessionID(ctx, slotProps, api) {
  const pick = (...candidates) => {
    for (const c of candidates) {
      if (c === undefined || c === null) continue;
      const s = String(c).trim();
      if (s) return s;
    }
    return undefined;
  };

  let id = pick(
    ctx?.session_id,
    ctx?.sessionId,
    ctx?.sessionID,
    slotProps?.session_id,
    slotProps?.sessionId,
    slotProps?.sessionID,
  );

  if (id) return id;

  try {
    const route = api?.route?.current;
    const params = route?.params && typeof route.params === "object" ? route.params : {};
    id = pick(params.sessionID, params.session_id, params.sessionId, params.id);
    if (id) return id;
  } catch {
    /* route API optional */
  }

  try {
    const session = api?.state?.session;
    if (session && typeof session.current === "function") {
      const cur = session.current();
      const info = messageInfo(cur);
      id = pick(info?.id, cur?.id);
      if (id) return id;
    }
    if (session && typeof session.active === "function") {
      const cur = session.active();
      const info = messageInfo(cur);
      id = pick(info?.id, cur?.id);
      if (id) return id;
    }
  } catch {
    /* state API optional */
  }

  return undefined;
}

/**
 * Session id on an event payload, if any.
 *
 * @param {Record<string, unknown>} evProps
 * @param {Record<string, unknown>|null|undefined} part
 */
export function eventSessionID(evProps, part) {
  const p = part && typeof part === "object" ? part : {};
  const info =
    evProps.info && typeof evProps.info === "object"
      ? evProps.info
      : evProps.message && typeof evProps.message === "object"
        ? messageInfo(evProps.message)
        : null;
  return (
    p.sessionID ??
    p.sessionId ??
    p.session_id ??
    evProps.sessionID ??
    evProps.sessionId ??
    evProps.session_id ??
    info?.sessionID ??
    info?.sessionId ??
    info?.session_id
  );
}

/**
 * Whether an event should update a per-session sidebar view.
 * Unscoped events (no session id) are ignored by default so multiple mounted
 * meters do not all ingest the same stream.
 *
 * @param {string} viewSessionID
 * @param {unknown} evSession
 * @param {{ allowUnscoped?: boolean }} [opts]
 */
export function eventBelongsToView(viewSessionID, evSession, opts = {}) {
  const allowUnscoped = opts.allowUnscoped === true;
  if (evSession === undefined || evSession === null || evSession === "") {
    return allowUnscoped;
  }
  return String(evSession) === String(viewSessionID);
}

/** @param {Record<string, unknown>} evProps */
export function removalSessionID(evProps) {
  const msg = evProps.message && typeof evProps.message === "object" ? evProps.message : null;
  const info = messageInfo(evProps.info ?? msg);
  return eventSessionID(evProps, null) ?? info?.sessionID ?? info?.sessionId ?? info?.session_id;
}

/** @param {Record<string, unknown>} evProps */
export function removalMessageID(evProps) {
  const msg = evProps.message && typeof evProps.message === "object" ? evProps.message : null;
  return (
    evProps.messageID ??
    evProps.message_id ??
    evProps.id ??
    msg?.id ??
    (messageInfo(msg)?.id)
  );
}

/** @param {unknown} value */
export function deltaTextLength(value) {
  if (typeof value === "string") return value.length;
  if (!value || typeof value !== "object") return 0;
  const o = /** @type {Record<string, unknown>} */ (value);
  if (typeof o.text === "string") return o.text.length;
  if (typeof o.content === "string") return o.content.length;
  if (typeof o.value === "string") return o.value.length;
  return 0;
}

/** @param {Record<string, unknown>|null|undefined} tokens */
export function generatedTokens(tokens) {
  return (Number(tokens?.output) || 0) + (Number(tokens?.reasoning) || 0);
}

/**
 * Synthesize a completed assistant-shaped message from session.get() summary
 * when per-message arrays are unavailable in the TUI runtime.
 *
 * @param {Record<string, unknown>|null|undefined} current
 * @param {string} fallbackSessionID
 */
export function summaryMessage(current, fallbackSessionID) {
  if (!current?.tokens || !generatedTokens(current.tokens)) return null;
  const model = current.model && typeof current.model === "object" ? current.model : {};
  return {
    id: `${current.id ?? fallbackSessionID}:summary`,
    role: "assistant",
    tokens: current.tokens,
    time: {
      created: current.time?.created,
      completed: current.time?.updated ?? current.time?.completed,
    },
    cost: current.cost,
    modelID: model.id,
    providerID: model.providerID,
  };
}