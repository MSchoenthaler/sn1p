import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";
import { createDocService } from "../lib/doc-service.js";
import { removeDoc, withDocLock } from "../lib/doc-store.js";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check) {
  for (let i = 0; i < 600; i++) {
    if (check()) return;
    await tick();
  }
  assert.fail("Timed out waiting for client state");
}

// Minimal DOM with textarea assignment/selection behavior. Crypto, client code,
// protocol handling, and file persistence are the production implementations.
class Element {
  listeners = new Map();
  children = [];
  style = { setProperty() {} };
  classList = { contains() { return false; }, toggle() {}, add() {} };
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = "none";
  scrollTop = 0;
  scrollLeft = 0;
  clientWidth = 800;
  _value = "";
  set value(value) { this._value = value; this.selectionStart = this.selectionEnd = value.length; }
  get value() { return this._value; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({}); }
  setSelectionRange(start, end, direction = "none") { Object.assign(this, { selectionStart: start, selectionEnd: end, selectionDirection: direction }); }
  setAttribute() {}
  removeAttribute() {}
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return null; }
  focus() { this.dispatch("focus"); }
  select() {}
}

async function client(service, name, t, { legacyProtocol = false } = {}) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const timers = new Set();
  const sockets = [];
  let ackDelay = 0;
  let releaseDelay = 0;
  class ClientSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    constructor() {
      sockets.push(this);
      this.server = new EventEmitter();
      this.server.readyState = 1;
      this.server.send = (data) => {
        const message = JSON.parse(data);
        if (legacyProtocol) delete message.syncProtocol;
        setTimeout(() => {
          if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
        }, message.type === "upsertAck" ? ackDelay : message.type === "releaseAck" ? releaseDelay : 0);
      };
      this.server.ping = () => this.server.emit("pong");
      this.server.terminate = this.server.close = () => this.close();
      service.handleWsConnection(this.server, { url: `/?doc=${name}`, headers: { host: "localhost" } }).then(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(data) { this.server.emit("message", Buffer.from(data)); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = this.server.readyState = 3;
      this.server.emit("close");
      this.onclose?.();
    }
  }
  const context = createContext({
    console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob,
    location: { pathname: `/${name}`, host: "localhost", protocol: "http:" },
    document: { querySelector: element, documentElement: new Element(), body: new Element(),
      createElement: () => new Element(), createDocumentFragment: () => new Element(), addEventListener() {} },
    window: new Element(), localStorage: { getItem() { return null; }, setItem() {} },
    getComputedStyle: () => ({ lineHeight: "21", fontSize: "14" }),
    requestAnimationFrame() {},
    setTimeout: (fn, delay) => { const id = setTimeout(fn, delay); timers.add(id); return id; }, clearTimeout,
    WebSocket: ClientSocket,
    fetch: async (url, options) => {
      const response = options ? await service.unlockDocument(name, JSON.parse(options.body).auth)
        : await service.getDocMeta(name);
      return { status: response.status, ok: response.status === 200, json: async () => structuredClone(response.body) };
    }
  });
  runInContext(source + `\nglobalThis.api = { state, editor, requestTabLock, releaseTabEditing, upsertTabState,
    switchTab, renameTabFlow, changePassword, deleteTabFlow, connectWs, canEditTab, getPersistedTabs,
    unlock: async () => { passwordInput.value = "test password"; await unlockWithPassword(); },
    input: (text, caret = text.length) => { editor.value = text; editor.setSelectionRange(caret, caret); editor.dispatch("input"); },
    addTab: (id, text) => { ensureLocalTabState(id, {name: id, text, persisted: false}); queueSaveForTab(id, text); },
    rotate: async () => { newPasswordInput.value = "new password"; await changePassword(); },
    status: () => statusEl.textContent
  };`, context);
  const api = context.api;
  api.delayAck = (delay) => { ackDelay = delay; };
  api.delayRelease = (delay) => { releaseDelay = delay; };
  t.after(() => {
    api.state.authToken = null;
    sockets.forEach((socket) => socket.close());
    timers.forEach(clearTimeout);
  });
  await until(() => api.state.kdf);
  await api.unlock();
  return api;
}

async function pair(t) {
  const name = `clienttest${randomUUID().replaceAll("-", "")}`;
  const service = createDocService();
  t.after(async () => { await withDocLock(name, () => removeDoc(name)); });
  const a = await client(service, name, t);
  const tabId = a.state.activeTabId;
  a.input("original");
  await a.upsertTabState(tabId);
  const b = await client(service, name, t);
  await until(() => b.editor.value === "original");
  return { a, b, tabId };
}

test("two open clients: reader sees edits, caret survives acks, debounce releases ownership", async (t) => {
  const { a, b, tabId } = await pair(t);
  assert.equal(b.editor.readOnly, true);
  a.input("first original", 6);
  a.delayAck(75);
  const saving = a.upsertTabState(tabId);
  await until(() => b.editor.value === "first original");
  a.input("first Xoriginal", 7);
  await saving;
  await until(() => b.editor.value === "first Xoriginal");
  assert.equal(a.editor.selectionStart, 7);
  await until(() => !a.state.ownedLocks.has(tabId) && !b.editor.readOnly);
  b.input("second first Xoriginal", 7);
  await b.upsertTabState(tabId);
  await until(() => a.editor.value === "second first Xoriginal");
  assert.equal(a.editor.readOnly, true);
  assert.equal(b.editor.selectionStart, 7);
});

test("pending saves survive tab switches and clients edit different tabs", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.addTab("other", "other text");
  await a.upsertTabState("other");
  await a.releaseTabEditing("other");
  await until(() => b.state.tabs.has("other"));
  a.input("pending first tab");
  await a.switchTab("other");
  await until(() => b.state.tabs.get(tabId)?.text === "pending first tab");
  assert.equal(a.editor.value, "other text");
  await a.releaseTabEditing(tabId);
  await b.switchTab(tabId);
  a.input("A edits other");
  b.input("B edits first");
  await Promise.all([a.upsertTabState("other"), b.upsertTabState(tabId)]);
  await until(() => a.state.tabs.get(tabId)?.text === "B edits first" && b.state.tabs.get("other")?.text === "A edits other");
});

test("simultaneous input preserves the losing draft instead of overwriting the owner", async (t) => {
  const { a, b, tabId } = await pair(t);
  await a.releaseTabEditing(tabId);
  await until(() => !b.editor.readOnly);
  a.input("client A draft");
  b.input("client B draft");
  await Promise.all([a.upsertTabState(tabId), b.upsertTabState(tabId)]);
  await until(() => [...a.state.tabs.values(), ...b.state.tabs.values()].some((tab) => tab.name.endsWith("(recovered)")));
  await until(() => a.state.dirtyTabs.size === 0 && b.state.dirtyTabs.size === 0);
  const texts = new Set([...a.state.tabs.values(), ...b.state.tabs.values()].map((tab) => tab.text));
  assert.ok(texts.has("client A draft"));
  assert.ok(texts.has("client B draft"));
});

test("reconnection retains an unsent draft when another owner has changed the tab", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.input("unsent draft");
  a.state.ws.close();
  await until(() => !b.editor.readOnly);
  b.input("new owner text");
  await b.upsertTabState(tabId);
  await b.releaseTabEditing(tabId);
  await until(() => a.state.wsReady);
  await until(() => [...a.state.tabs.values()].some((tab) => tab.text === "unsent draft" && tab.name.endsWith("(recovered)")));
  assert.equal(a.editor.value, "new owner text");
});

test("password rotation respects a reader's active editing lock", async (t) => {
  const { a, b, tabId } = await pair(t);
  await b.rotate();
  assert.match(b.status(), /Another client is editing/);
  await a.releaseTabEditing(tabId);
  await b.rotate();
  assert.match(b.status(), /Password updated/);
  await until(() => !a.state.key);
  assert.equal(b.editor.value, "original");
});

test("typing during the release acknowledgement is buffered and reacquires ownership", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.delayRelease(100);
  const releasing = a.releaseTabEditing(tabId);
  await until(() => a.state.handoffs.has(tabId));
  assert.equal(a.editor.readOnly, false);
  a.input("typed during handoff", 5);
  await releasing;
  await a.upsertTabState(tabId);
  await until(() => b.editor.value === "typed during handoff");
  assert.equal(a.editor.selectionStart, 5);
});

test("composition holds ownership until composition ends", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.editor.dispatch("compositionstart");
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.equal(a.state.ownedLocks.has(tabId), true);
  assert.equal(b.editor.readOnly, true);
  a.editor.dispatch("compositionend");
  await a.releaseTabEditing(tabId);
  await until(() => !b.editor.readOnly);
});

test("clearing and renaming keep both clients attached without changing the caret", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.input("");
  await a.upsertTabState(tabId);
  await until(() => b.editor.value === "");
  assert.equal(a.state.wsReady && b.state.wsReady, true);
  await a.renameTabFlow(tabId, "shared");
  await until(() => b.state.tabs.get(tabId)?.name === "shared");
  a.input("new content", 3);
  await a.upsertTabState(tabId);
  await until(() => b.editor.value === "new content");
  assert.equal(a.editor.selectionStart, 3);
});

test("continuous typing reaches the reader without waiting for a pause", async (t) => {
  const { a, b, tabId } = await pair(t);
  const observed = new Set();
  for (let i = 1; i <= 16; i++) {
    a.input(`continuous ${"x".repeat(i)}`, 4);
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (b.editor.value.startsWith("continuous")) observed.add(b.editor.value);
  }
  assert.ok(observed.size >= 2, `Expected live updates during typing; received ${observed.size}`);
  assert.equal(a.editor.selectionStart, 4);
  await until(() => b.editor.value === a.editor.value);
  await until(() => !a.state.ownedLocks.has(tabId) && !a.state.releasing.has(tabId));
});

test("focusing or clicking a reader does not claim editing ownership", async (t) => {
  const { a, b, tabId } = await pair(t);
  await a.releaseTabEditing(tabId);
  await until(() => !b.editor.readOnly);
  b.editor.focus();
  b.editor.dispatch("pointerdown");
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(b.state.ownedLocks.has(tabId), false);
  assert.equal(a.editor.readOnly, false);
  a.input("writer keeps typing");
  await until(() => b.editor.value === "writer keeps typing");
});

test("an old running server shows a restart message instead of a reconnect loop", async (t) => {
  const name = `clienttest${randomUUID().replaceAll("-", "")}`;
  const a = await client(createDocService(), name, t, { legacyProtocol: true });
  assert.equal(a.state.syncUnsupported, true);
  assert.equal(a.state.wsReady, false);
  assert.equal(a.editor.readOnly, true);
  assert.match(a.status(), /Restart yarn start/);
  assert.equal(a.state.reconnectTimer, null);
  assert.equal(a.state.requests.size, 0);
});
