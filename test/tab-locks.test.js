import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { createDocService } from "../lib/doc-service.js";
import { loadDoc, writeDoc, removeDoc, withDocLock } from "../lib/doc-store.js";

class Socket extends EventEmitter {
  readyState = 1;
  received = [];
  send(data) { this.received.push(JSON.parse(data)); this.emit("received"); }
  ping() { this.emit("pong"); }
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
  async request(message, type) {
    const requestId = randomUUID();
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off("received", check); reject(new Error(`No response: ${JSON.stringify(message)}`)); }, 2000);
      const check = () => {
        const response = this.received.find((msg) => msg.requestId === requestId || (type && msg.type === type));
        if (!response) return;
        clearTimeout(timer);
        this.off("received", check);
        resolve(response);
      };
      this.on("received", check);
    });
    this.emit("message", Buffer.from(JSON.stringify({ auth: "secret", ...message, requestId })));
    return result;
  }
}

async function fixture(t) {
  const name = `locktest${randomUUID().replaceAll("-", "")}`;
  const service = createDocService();
  const entry = { nameIv: "nameiv", nameCt: "namect", iv: "iv", ct: "original", ts: 123, revision: "original" };
  await writeDoc(name, { v: 3, kdf: { salt: "salt" }, tabs: { first: entry, second: entry },
    meta: { initialTabId: "first" }, auth: { tokenHash: createHash("sha256").update("secret").digest("base64") } });
  const sockets = [];
  const connect = async () => {
    const socket = new Socket();
    sockets.push(socket);
    await service.handleWsConnection(socket, { url: `/?doc=${name}`, headers: { host: "localhost" } });
    await socket.request({ type: "auth" }, "authOk");
    return socket;
  };
  t.after(async () => {
    sockets.forEach((socket) => socket.close());
    await withDocLock(name, () => removeDoc(name));
  });
  return { name, entry, a: await connect(), b: await connect(), connect };
}

test("simultaneous clients receive one owner; both remain connected", async (t) => {
  const { a, b } = await fixture(t);
  const responses = await Promise.all([a.request({ type: "acquireTab", tabId: "first" }), b.request({ type: "acquireTab", tabId: "first" })]);
  assert.deepEqual(responses.map((r) => r.type).sort(), ["lockDenied", "lockGranted"]);
  assert.equal(a.readyState, 1);
  assert.equal(b.readyState, 1);
  assert.equal((await b.request({ type: "acquireTab", tabId: "second" })).type, "lockGranted");
});

test("server rejects non-owner saves, renames and deletes, including copied tokens", async (t) => {
  const { a, b, name, entry } = await fixture(t);
  const owner = await a.request({ type: "acquireTab", tabId: "second" });
  for (const change of [
    { type: "upsertTab", entry: { ...entry, ct: "overwrite" } },
    { type: "upsertTab", entry: { nameIv: "other", nameCt: "other" } },
    { type: "deleteTab" }
  ]) {
    const result = await b.request({ ...change, tabId: "second", lockToken: owner.lockToken });
    assert.equal(result.reason, "locked");
  }
  assert.equal((await loadDoc(name)).tabs.second.ct, "original");
});

test("handoff waits for ordered saves and gives the next owner the latest content", async (t) => {
  const { a, b, entry, name } = await fixture(t);
  const { lockToken } = await a.request({ type: "acquireTab", tabId: "first" });
  const save = a.request({ type: "upsertTab", tabId: "first", lockToken, entry: { ...entry, ct: "latest", ts: 1 } });
  const release = a.request({ type: "releaseTab", tabId: "first", lockToken });
  await Promise.all([save, release]);
  const next = await b.request({ type: "acquireTab", tabId: "first" });
  assert.equal(next.entry.ct, "latest", "client clock skew must not discard the owner's save");
  assert.notEqual(next.lockToken, lockToken);
  const stale = await a.request({ type: "upsertTab", tabId: "first", lockToken, entry });
  assert.equal(stale.reason, "locked");
  assert.equal((await loadDoc(name)).tabs.first.ct, "latest");
  assert.ok(b.received.some((m) => m.type === "upsertTab" && m.entry.ct === "latest"));
});

test("disconnect releases all locks and reconnect returns a fresh snapshot", async (t) => {
  const { a, b, connect } = await fixture(t);
  await a.request({ type: "acquireTab", tabId: "first" });
  await a.request({ type: "acquireTab", tabId: "second" });
  a.close();
  assert.equal((await b.request({ type: "acquireTab", tabId: "first" })).type, "lockGranted");
  assert.equal((await b.request({ type: "acquireTab", tabId: "second" })).type, "lockGranted");
  const c = await connect();
  const snapshot = c.received.find((msg) => msg.type === "authOk");
  assert.deepEqual(snapshot.lockedTabs.sort(), ["first", "second"]);
  assert.equal(snapshot.doc.tabs.first.ct, "original");
  assert.equal(snapshot.doc.auth, undefined);
});

test("clearing the first tab keeps shared document identity and reader connections", async (t) => {
  const { a, b, name, entry } = await fixture(t);
  const { lockToken } = await a.request({ type: "acquireTab", tabId: "first" });
  await a.request({ type: "upsertTab", tabId: "first", lockToken,
    entry: { nameIv: entry.nameIv, nameCt: entry.nameCt, ts: 100 } });
  const doc = await loadDoc(name);
  assert.equal(doc.tabs.first.ct, undefined);
  assert.equal(doc.meta.initialTabId, "first");
  assert.equal(b.readyState, 1);
});

test("password rotation cannot replace another editor's content", async (t) => {
  const { a, b, entry, name } = await fixture(t);
  await a.request({ type: "acquireTab", tabId: "first" });
  const result = await b.request({ type: "rotateKdf", kdf: { salt: "new" }, nextAuth: "new",
    tabs: { first: entry, second: entry } });
  assert.equal(result.type, "rotateError");
  assert.equal(result.reason, "locked");
  assert.equal((await loadDoc(name)).kdf.salt, "salt");
});

test("password rotation requires ownership and the current revision of every tab", async (t) => {
  const { a, name, entry } = await fixture(t);
  const first = await a.request({ type: "acquireTab", tabId: "first" });
  const second = await a.request({ type: "acquireTab", tabId: "second" });
  const message = { type: "rotateKdf", kdf: { salt: "new" }, nextAuth: "new",
    tabs: { first: entry, second: entry }, lockTokens: { first: first.lockToken, second: second.lockToken } };
  assert.equal((await a.request({ ...message, revisions: {} })).reason, "locked");
  assert.equal((await a.request({ ...message, revisions: { first: "original", second: "original" } })).type, "rekey");
  assert.equal((await loadDoc(name)).kdf.salt, "new");
});
