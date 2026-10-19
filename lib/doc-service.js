import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { createTabLocks } from "./tab-locks.js";
import {
  canonicalDocName,
  loadDoc,
  nowIso,
  withDocLock,
  writeDoc
} from "./doc-store.js";
import { broadcast, joinChannel, leaveChannel, sendWs } from "./ws-hub.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toClientDoc(doc) {
  if (!doc) return doc;
  const { auth, ...rest } = doc;
  return rest;
}

function toClientMeta(doc) {
  if (!doc) return doc;
  return {
    v: doc.v,
    kdf: doc.kdf,
    meta: {
      createdAt: doc.meta?.createdAt || null,
      updatedAt: doc.meta?.updatedAt || null,
      initialTabId: doc.meta?.initialTabId || null
    }
  };
}

function hashAuthToken(token) {
  return createHash("sha256").update(String(token)).digest("base64");
}

function sameHash(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(a, "base64");
  const right = Buffer.from(b, "base64");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
const AUTH_DELAY_AFTER_FAILS = 5;
const AUTH_LOCK_AFTER_FAILS = 10;
const AUTH_LOCK_MS = 10 * 60 * 1000;

function ensureAuthState(doc) {
  if (!doc.auth) doc.auth = {};
  if (!Array.isArray(doc.auth.failures)) doc.auth.failures = [];
  if (!("lockUntil" in doc.auth)) doc.auth.lockUntil = null;
}

function pruneAuthFailures(doc, now = Date.now()) {
  ensureAuthState(doc);
  doc.auth.failures = doc.auth.failures
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0 && now - value <= AUTH_FAIL_WINDOW_MS);

  if (doc.auth.lockUntil) {
    const lockUntilMs = Date.parse(doc.auth.lockUntil);
    if (!lockUntilMs || lockUntilMs <= now) {
      doc.auth.lockUntil = null;
    }
  }
}

function clearAuthFailures(doc) {
  ensureAuthState(doc);
  doc.auth.failures = [];
  doc.auth.lockUntil = null;
}

function recordFailedAuth(doc, now = Date.now()) {
  pruneAuthFailures(doc, now);
  doc.auth.failures.push(now);

  let lockUntil = null;
  if (doc.auth.failures.length >= AUTH_LOCK_AFTER_FAILS) {
    lockUntil = new Date(now + AUTH_LOCK_MS).toISOString();
    doc.auth.lockUntil = lockUntil;
  }

  const delayMs =
    doc.auth.failures.length >= AUTH_DELAY_AFTER_FAILS && !lockUntil
      ? 1500
      : 0;

  doc.auth.lastFailedAt = new Date(now).toISOString();
  return { delayMs, lockUntil, failureCount: doc.auth.failures.length };
}

function authorizeDoc(doc, authToken, now = Date.now()) {
  if (!doc || !authToken) return { ok: false, reason: "missingAuth", delayMs: 0, lockUntil: null };

  ensureAuthState(doc);
  pruneAuthFailures(doc, now);

  if (doc.auth.lockUntil) {
    return { ok: false, reason: "locked", delayMs: 0, lockUntil: doc.auth.lockUntil };
  }

  if (!doc.auth?.tokenHash) {
    doc.auth = {
      ...doc.auth,
      tokenHash: hashAuthToken(authToken),
      establishedAt: nowIso()
    };
    clearAuthFailures(doc);
    return { ok: true, delayMs: 0, lockUntil: null };
  }

  if (sameHash(doc.auth.tokenHash, hashAuthToken(authToken))) {
    clearAuthFailures(doc);
    return { ok: true, delayMs: 0, lockUntil: null };
  }

  return { ok: false, reason: "badAuth", ...recordFailedAuth(doc, now) };
}

function createEmptyDoc(initKdf, authToken) {
  if (!initKdf || !authToken) throw new Error("Cannot create doc without kdf and auth");
  const createdAt = nowIso();
  return {
    v: 3,
    kdf: initKdf,
    tabs: {},
    meta: { createdAt, updatedAt: createdAt, initialTabId: null },
    auth: {
      tokenHash: hashAuthToken(authToken),
      establishedAt: createdAt,
      failures: [],
      lockUntil: null
    }
  };
}

function isTabEntryShape(entry) {
  return !!entry && typeof entry === "object";
}

function sanitizeTabId(tabId) {
  return (tabId || "")
    .toString()
    .trim()
    .slice(0, 120);
}

function sanitizeTabEntry(entry) {
  if (!isTabEntryShape(entry)) return null;
  const out = {};
  if (entry.nameIv && entry.nameCt) {
    out.nameIv = String(entry.nameIv);
    out.nameCt = String(entry.nameCt);
  }
  if (entry.ts) {
    out.ts = Number(entry.ts) || Date.now();
  }
  if (entry.iv && entry.ct) {
    out.iv = String(entry.iv);
    out.ct = String(entry.ct);
    if (!out.ts) out.ts = Date.now();
  } else if (entry.iv || entry.ct) {
    return null;
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function authorizeExistingDocAccess(name, authToken, onAuthorized) {
  let authFailure = null;
  let authorized = false;
  let pendingCreate = false;

  await withDocLock(name, async () => {
    const current = await loadDoc(name);
    if (!current) {
      pendingCreate = !!authToken;
      if (!pendingCreate) {
        authFailure = { reason: "missingAuth", delayMs: 0, lockUntil: null };
      }
      return;
    }
    if (current.v !== 3) {
      authFailure = { reason: "unsupported", delayMs: 0, lockUntil: null };
      return;
    }

    const hadFailures = !!(current.auth?.failures?.length || current.auth?.lockUntil);
    const authResult = authorizeDoc(current, authToken);
    if (!authResult.ok) {
      await writeDoc(name, current);
      authFailure = {
        reason: authResult.reason || "badAuth",
        delayMs: authResult.delayMs || 0,
        lockUntil: authResult.lockUntil || null
      };
      return;
    }

    if (hadFailures) {
      await writeDoc(name, current);
    }
    authorized = true;
    onAuthorized(current);
  });

  return { authorized, pendingCreate, authFailure };
}

export function createDocService() {
  const locks = createTabLocks();
  const requireLock = (name, tabId, ws, token) => {
    if (!locks.owns(name, tabId, ws, token)) {
      const err = new Error("Editing lock required");
      err.code = "TAB_LOCKED";
      throw err;
    }
  };
  return {
    async getDocMeta(name) {
      const safeName = canonicalDocName(name);
      if (!safeName) return { status: 400, body: { error: "Invalid document id" } };
      const doc = await loadDoc(safeName);
      if (!doc) return { status: 404, body: { notFound: true } };
      return { status: 200, body: toClientMeta(doc) };
    },

    async unlockDocument(name, authToken) {
      const safeName = canonicalDocName(name);
      if (!safeName) return { status: 400, body: { error: "Invalid document id" } };
      const doc = await loadDoc(safeName);
      if (!doc) return { status: 404, body: { notFound: true } };
      if (doc.v !== 3) return { status: 400, body: { error: "Unsupported document format" } };

      let unlockedDoc = null;
      let authFailure = null;

      await withDocLock(safeName, async () => {
        const current = await loadDoc(safeName);
        if (!current) {
          authFailure = { status: 404, body: { notFound: true } };
          return;
        }

        const hadFailures = !!(current.auth?.failures?.length || current.auth?.lockUntil);
        const authResult = authorizeDoc(current, authToken);
        if (!authResult.ok) {
          await writeDoc(safeName, current);
          authFailure = {
            status: authResult.reason === "locked" ? 423 : 401,
            body: {
              error: authResult.reason === "locked" ? "Document temporarily locked" : "Invalid password",
              reason: authResult.reason || "badAuth",
              lockUntil: authResult.lockUntil || null
            },
            delayMs: authResult.delayMs || 0
          };
          return;
        }

        if (hadFailures) {
          await writeDoc(safeName, current);
        }
        unlockedDoc = current;
      });

      if (authFailure) {
        if (authFailure.delayMs) await sleep(authFailure.delayMs);
        return { status: authFailure.status, body: authFailure.body };
      }

      return { status: 200, body: { ok: true, doc: toClientDoc(unlockedDoc) } };
    },

    async handleWsConnection(ws, req) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const name = canonicalDocName(url.searchParams.get("doc"));
      if (!name) {
        sendWs(ws, { type: "authError", reason: "invalidDoc" });
        try {
          ws.close(4002, "Invalid document");
        } catch {
          // ignore close errors
        }
        return;
      }

      let alive = true;
      ws.on("pong", () => { alive = true; });
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 15000);
      heartbeat.unref();

      let messages = Promise.resolve();
      const handleMessage = async (data) => {
        try {
          if (ws.readyState !== 1) return;
          const msg = JSON.parse(data.toString());

          if (msg.type === "auth") {
            const access = await authorizeExistingDocAccess(name, msg.auth, (doc) => {
              ws._authorized = true;
              joinChannel(name, ws);
              sendWs(ws, { type: "authOk", syncProtocol: "tab-locks-v1", doc: toClientDoc(doc), lockedTabs: locks.list(name) });
            });
            if (!access.authorized) {
              if (access.pendingCreate) {
                ws._pendingCreate = true;
                ws._pendingAuth = String(msg.auth);
                sendWs(ws, { type: "authOk", syncProtocol: "tab-locks-v1", lockedTabs: locks.list(name) });
                return;
              }
              if (access.authFailure?.delayMs) await sleep(access.authFailure.delayMs);
              sendWs(ws, {
                type: "authError",
                reason: access.authFailure?.reason || "badAuth",
                lockUntil: access.authFailure?.lockUntil || null
              });
              try {
                ws.close(4001, "Unauthorized");
              } catch {
                // ignore close errors
              }
              return;
            }

            return;
          }

          if (!ws._authorized) {
            const canCreatePendingDoc =
              ws._pendingCreate &&
              ["upsertTab", "rotateKdf", "acquireTab", "releaseTab"].includes(msg.type);
            if (canCreatePendingDoc) {
              // Let the first valid create write establish the doc, but do not
              // join the broadcast channel until that write succeeds.
            } else {
              sendWs(ws, { type: "authError", reason: "missingAuth" });
              return;
            }
          }

          if (msg.type === "acquireTab" || msg.type === "releaseTab") {
            const tabId = sanitizeTabId(msg.tabId);
            if (!tabId) return;
            let authFailure = null;
            await withDocLock(name, async () => {
              if (ws.readyState !== 1) return;
              if (msg.type === "releaseTab") {
                if (locks.release(name, tabId, ws, msg.lockToken)) {
                  broadcast(name, { type: "tabLock", tabId, locked: false });
                }
                sendWs(ws, { type: "releaseAck", tabId, requestId: msg.requestId });
                return;
              }
              const doc = await loadDoc(name);
              // Recheck credentials, including sessions opened before a password change.
              if (doc) {
                const access = authorizeDoc(doc, msg.auth);
                if (!access.ok) {
                  await writeDoc(name, doc);
                  authFailure = access;
                  return;
                }
                ws._authorized = true;
                joinChannel(name, ws);
              }
              const token = locks.acquire(name, tabId, ws);
              if (!token) {
                sendWs(ws, { type: "lockDenied", tabId, requestId: msg.requestId });
                return;
              }
              sendWs(ws, { type: "lockGranted", tabId, lockToken: token,
                entry: doc?.tabs?.[tabId] || null, requestId: msg.requestId });
              broadcast(name, { type: "tabLock", tabId, locked: true }, ws);
            });
            if (authFailure) {
              if (authFailure.delayMs) await sleep(authFailure.delayMs);
              sendWs(ws, { type: "authError", reason: authFailure.reason, lockUntil: authFailure.lockUntil });
              ws.close(4001, "Unauthorized");
            }
            return;
          }

          if (msg.type === "upsertTab") {
            const tabId = sanitizeTabId(msg.tabId);
            const initialTabId = sanitizeTabId(msg.initialTabId);
            const safeEntry = sanitizeTabEntry(msg.entry);
            const safeTs = safeEntry?.ts || Date.now();
            if (!tabId || !safeEntry) {
              sendWs(ws, { type: "tabError", reason: "invalid", requestId: msg.requestId });
              return;
            }

            let storedEntry = null;
            let emptied = false;
            try {
              await withDocLock(name, async () => {
                requireLock(name, tabId, ws, msg.lockToken);
                let doc = await loadDoc(name);
                if (!doc) {
                  if (!ws._pendingCreate || !ws._pendingAuth || String(msg.auth || "") !== ws._pendingAuth) {
                    const err = new Error("Unauthorized");
                    err.code = "AUTH";
                    err.reason = "missingAuth";
                    err.delayMs = 0;
                    err.lockUntil = null;
                    throw err;
                  }
                  doc = createEmptyDoc(msg.kdf, msg.auth);
                } else {
                  const authResult = doc.v === 3 ? authorizeDoc(doc, msg.auth) : { ok: false, reason: "unsupported", delayMs: 0, lockUntil: null };
                  if (!authResult.ok) {
                    if (doc.v === 3) await writeDoc(name, doc);
                    const err = new Error("Unauthorized");
                    err.code = "AUTH";
                    err.reason = authResult.reason;
                    err.delayMs = authResult.delayMs || 0;
                    err.lockUntil = authResult.lockUntil || null;
                    throw err;
                  }
                  if (doc.v === 3 && (doc.auth?.failures?.length || doc.auth?.lockUntil)) {
                    await writeDoc(name, doc);
                  }
                }

                const existing = doc.tabs[tabId] || {};
                const next = {
                  nameIv: safeEntry.nameIv,
                  nameCt: safeEntry.nameCt
                };

                if (!next.nameIv || !next.nameCt) {
                  const err = new Error("Invalid tab entry");
                  err.code = "INVALID_ENTRY";
                  throw err;
                }

                // Ownership, not the client's wall clock, determines write order.
                if (safeEntry.ts) {
                  if (safeEntry.iv && safeEntry.ct) {
                    next.iv = safeEntry.iv;
                    next.ct = safeEntry.ct;
                  }
                  next.ts = Math.max(Date.now(), (existing.ts || 0) + 1);
                } else if (existing.iv && existing.ct) {
                  next.iv = existing.iv;
                  next.ct = existing.ct;
                  next.ts = existing.ts;
                }

                next.revision = randomUUID();
                doc.tabs[tabId] = next;
                if (!doc.meta) doc.meta = { createdAt: nowIso(), updatedAt: nowIso(), initialTabId: null };
                if (!doc.meta.initialTabId) {
                  doc.meta.initialTabId =
                    initialTabId && doc.tabs[initialTabId]
                      ? initialTabId
                      : tabId;
                }

                // Retain empty documents so connected readers keep the same KDF and tab identity.
                doc.meta.updatedAt = nowIso();
                await writeDoc(name, doc);
                storedEntry = doc.tabs[tabId];
              });
            } catch (err) {
              if (err.code === "TAB_LOCKED") {
                sendWs(ws, { type: "tabError", reason: "locked", tabId, requestId: msg.requestId });
                return;
              }
              if (err.code === "AUTH") {
                if (err.delayMs) await sleep(err.delayMs);
                sendWs(ws, { type: "authError", reason: err.reason || "badAuth", lockUntil: err.lockUntil || null });
                return;
              }
              if (err.code === "INVALID_ENTRY") {
                sendWs(ws, { type: "tabError", reason: "invalidEntry", requestId: msg.requestId });
                return;
              }
              throw err;
            }

            if (!ws._authorized) {
              ws._authorized = true;
              ws._pendingCreate = false;
              ws._pendingAuth = null;
              joinChannel(name, ws);
            }
            broadcast(name, { type: "upsertTab", tabId, entry: storedEntry, emptied }, ws);
            sendWs(ws, { type: "upsertAck", tabId, entry: storedEntry, emptied, ts: safeTs, requestId: msg.requestId });
          } else if (msg.type === "deleteTab") {
            const tabId = sanitizeTabId(msg.tabId);
            if (!tabId) {
              sendWs(ws, { type: "tabError", reason: "invalid", requestId: msg.requestId });
              return;
            }

            let emptied = false;
            try {
              await withDocLock(name, async () => {
                requireLock(name, tabId, ws, msg.lockToken);
                const doc = await loadDoc(name);
                if (!doc) return;
                const authResult = doc.v === 3 ? authorizeDoc(doc, msg.auth) : { ok: false, reason: "unsupported", delayMs: 0, lockUntil: null };
                if (!authResult.ok) {
                  if (doc.v === 3) await writeDoc(name, doc);
                  const err = new Error("Unauthorized");
                  err.code = "AUTH";
                  err.reason = authResult.reason;
                  err.delayMs = authResult.delayMs || 0;
                  err.lockUntil = authResult.lockUntil || null;
                  throw err;
                }
                if (doc.auth?.failures?.length || doc.auth?.lockUntil) {
                  await writeDoc(name, doc);
                }
                if (doc.meta?.initialTabId === tabId) {
                  const err = new Error("Protected tab");
                  err.code = "PROTECTED_TAB";
                  throw err;
                }

                if (doc.tabs && doc.tabs[tabId]) {
                  delete doc.tabs[tabId];
                  doc.meta.updatedAt = nowIso();
                  await writeDoc(name, doc);
                }
              });
            } catch (err) {
              if (err.code === "TAB_LOCKED") {
                sendWs(ws, { type: "tabError", reason: "locked", tabId, requestId: msg.requestId });
                return;
              }
              if (err.code === "AUTH") {
                if (err.delayMs) await sleep(err.delayMs);
                sendWs(ws, { type: "authError", reason: err.reason || "badAuth", lockUntil: err.lockUntil || null });
                return;
              }
              if (err.code === "PROTECTED_TAB") {
                sendWs(ws, { type: "tabError", reason: "protectedTab", requestId: msg.requestId });
                return;
              }
              throw err;
            }

            broadcast(name, { type: "deleteTab", tabId, emptied }, ws);
            sendWs(ws, { type: "deleteAck", tabId, emptied, requestId: msg.requestId });
          } else if (msg.type === "rotateKdf") {
            const { kdf, tabs, auth, nextAuth } = msg;
            const initialTabId = sanitizeTabId(msg.initialTabId);
            if (!kdf || typeof tabs !== "object" || !tabs || !nextAuth) {
              sendWs(ws, { type: "rotateError", reason: "badPayload", requestId: msg.requestId });
              return;
            }

            const sanitizedTabs = {};
            for (const [tabIdRaw, entry] of Object.entries(tabs)) {
              const tabId = sanitizeTabId(tabIdRaw);
              const safeEntry = sanitizeTabEntry(entry);
              if (!tabId || !safeEntry || !safeEntry.nameIv || !safeEntry.nameCt) {
                sendWs(ws, { type: "rotateError", reason: "badPayload", requestId: msg.requestId });
                return;
              }
              sanitizedTabs[tabId] = safeEntry;
            }

            try {
              await withDocLock(name, async () => {
                if (locks.hasOtherOwner(name, ws)) {
                  const err = new Error("Another client is editing");
                  err.code = "TAB_LOCKED";
                  throw err;
                }
                let doc = await loadDoc(name);
                if (!doc) {
                  if (!ws._pendingCreate || !ws._pendingAuth || String(auth || "") !== ws._pendingAuth) {
                    const err = new Error("Unauthorized");
                    err.code = "AUTH";
                    err.reason = "missingAuth";
                    err.delayMs = 0;
                    err.lockUntil = null;
                    throw err;
                  }
                  doc = createEmptyDoc(kdf, nextAuth);
                } else {
                  const authResult = doc.v === 3 ? authorizeDoc(doc, auth) : { ok: false, reason: "unsupported", delayMs: 0, lockUntil: null };
                  if (!authResult.ok) {
                    if (doc.v === 3) await writeDoc(name, doc);
                    const err = new Error("Unauthorized");
                    err.code = "AUTH";
                    err.reason = authResult.reason;
                    err.delayMs = authResult.delayMs || 0;
                    err.lockUntil = authResult.lockUntil || null;
                    throw err;
                  }
                  if (doc.v === 3 && (doc.auth?.failures?.length || doc.auth?.lockUntil)) {
                    await writeDoc(name, doc);
                  }
                }

                const existingKeys = Object.keys(doc.tabs || {});
                for (const id of existingKeys) {
                  requireLock(name, id, ws, msg.lockTokens?.[id]);
                  if ((doc.tabs[id].revision || null) !== (msg.revisions?.[id] || null)) {
                    const err = new Error("Document changed during password rotation");
                    err.code = "TAB_LOCKED";
                    throw err;
                  }
                  if (sanitizedTabs[id]) sanitizedTabs[id].revision = randomUUID();
                }
                const incomingKeys = Object.keys(sanitizedTabs);
                const sameKeySet =
                  existingKeys.length === incomingKeys.length &&
                  existingKeys.every((key) => incomingKeys.includes(key));

                if (existingKeys.length > 0 && !sameKeySet) {
                  const err = new Error("Missing tabs");
                  err.code = "MISSING_TABS";
                  throw err;
                }

                doc.v = 3;
                doc.kdf = kdf;
                doc.tabs = sanitizedTabs;
                if (!doc.meta) doc.meta = { createdAt: nowIso(), updatedAt: nowIso(), initialTabId: null };
                if (!doc.meta.initialTabId) {
                  doc.meta.initialTabId =
                    initialTabId && sanitizedTabs[initialTabId]
                      ? initialTabId
                      : Object.keys(sanitizedTabs)[0] || null;
                }
                doc.auth = {
                  tokenHash: hashAuthToken(nextAuth),
                  establishedAt: doc.auth?.establishedAt || nowIso(),
                  rotatedAt: nowIso()
                };
                doc.meta.updatedAt = nowIso();
                await writeDoc(name, doc);
              });
            } catch (err) {
              if (err.code === "TAB_LOCKED") {
                sendWs(ws, { type: "rotateError", reason: "locked", requestId: msg.requestId });
                return;
              }
              if (err.code === "AUTH") {
                if (err.delayMs) await sleep(err.delayMs);
                sendWs(ws, { type: "authError", reason: err.reason || "badAuth", lockUntil: err.lockUntil || null });
                return;
              }
              if (err.code === "MISSING_TABS") {
                sendWs(ws, { type: "rotateError", reason: "missingTabs", requestId: msg.requestId });
                return;
              }
              throw err;
            }

            if (!ws._authorized) {
              ws._authorized = true;
              ws._pendingCreate = false;
              ws._pendingAuth = null;
              joinChannel(name, ws);
            }
            sendWs(ws, { type: "rekey", kdf, tabs: sanitizedTabs, requestId: msg.requestId });
            broadcast(name, { type: "rekey", kdf, tabs: sanitizedTabs }, ws);
          }
        } catch (err) {
          console.error("WS message error:", err);
          sendWs(ws, { type: "serverError", reason: "internal" });
        }
      };
      ws.on("message", (data) => {
        messages = messages.then(() => handleMessage(data));
      });

      ws.on("close", () => {
        clearInterval(heartbeat);
        leaveChannel(ws);
        withDocLock(name, async () => {
          for (const tabId of locks.releaseAll(name, ws)) {
            broadcast(name, { type: "tabLock", tabId, locked: false });
          }
        }).catch(console.error);
      });
    }
  };
}
