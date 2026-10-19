import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";
import { createDocService } from "../lib/doc-service.js";
import { removeDoc, withDocLock } from "../lib/doc-store.js";

const source = await readFile(new URL("../public/search.js", import.meta.url), "utf8") + "\n" +
  await readFile(new URL("../public/app.js", import.meta.url), "utf8");
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
  constructor(ownerDocument = null) { this.ownerDocument = ownerDocument; }
  dataset = {};
  attributes = new Map();
  listeners = new Map();
  children = [];
  style = { setProperty() {} };
  className = "";
  classList = {
    contains: (name) => this.className.split(/\s+/).includes(name),
    toggle: (name, force) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(" ");
    },
    add: (name) => this.classList.toggle(name, true)
  };
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = "none";
  scrollTop = 0;
  scrollLeft = 0;
  clientWidth = 800;
  clientHeight = 600;
  _value = "";
  set value(value) { this._value = value; this.selectionStart = this.selectionEnd = value.length; }
  get value() { return this._value; }
  set innerHTML(value) { this._innerHTML = value; this.children = []; }
  get innerHTML() { return this._innerHTML || ""; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); }
  setSelectionRange(start, end, direction = "none") { Object.assign(this, { selectionStart: start, selectionEnd: end, selectionDirection: direction }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  querySelector(selector) {
    return selector.startsWith(".") ? descendants(this).find((el) => el.classList.contains(selector.slice(1))) || null : null;
  }
  getBoundingClientRect() { return { top: 0, left: 0, height: 21 }; }
  scrollIntoView() {}
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    this.dispatch("focus");
  }
  select() {}
}

async function client(service, name, t, { legacyProtocol = false, storage = new Map() } = {}) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element(document));
    return elements.get(selector);
  };
  const document = { activeElement: null, querySelector: element, documentElement: new Element(), body: new Element(),
    createElement: () => new Element(document), createDocumentFragment: () => new Element(document),
    createTextNode: (text) => Object.assign(new Element(document), { textContent: text }), addEventListener() {} };
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
    document,
    window: new Element(), localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
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
  api.focused = () => document.activeElement;
  api.element = element;
  api.storage = storage;
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

function pressEditorKey(client, key = "Tab", options = {}) {
  const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options };
  client.editor.dispatch("keydown", event);
  return event.defaultPrevented;
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function currentHighlight(client) {
  return descendants(client.element("#editor-search-highlights")).find((el) => el.classList.contains("current"));
}

test("spellcheck defaults off and toggles locally without changing note content or caret", async (t) => {
  const { a, b } = await pair(t);
  const toggle = a.element("#spellcheck-toggle");
  assert.equal(a.editor.spellcheck, false);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.title, "Enable spell check");
  assert.match(toggle.innerHTML, /viewBox="0 0 16 16"/);
  a.editor.setSelectionRange(2, 2);
  toggle.dispatch("click");
  assert.equal(a.editor.spellcheck, true);
  assert.equal(toggle.classList.contains("active"), true);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Disable spell check");
  assert.equal(a.storage.get("sn1p-spellcheck-enabled"), "1");
  assert.equal(b.editor.spellcheck, false);
  assert.equal(a.editor.value, "original");
  assert.equal(a.editor.selectionStart, 2);
  assert.equal(a.state.dirtyTabs.size, 0);
  toggle.dispatch("click");
  assert.equal(a.editor.spellcheck, false);
  assert.equal(toggle.classList.contains("active"), false);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(a.storage.get("sn1p-spellcheck-enabled"), "0");
});

test("spellcheck restores the browser preference when reopening a note", async (t) => {
  const name = `clienttest${randomUUID().replaceAll("-", "")}`;
  const service = createDocService();
  t.after(async () => { await withDocLock(name, () => removeDoc(name)); });
  const storage = new Map([["sn1p-spellcheck-enabled", "1"]]);
  const a = await client(service, name, t, { storage });
  assert.equal(a.editor.spellcheck, true);
  assert.equal(a.element("#spellcheck-toggle").classList.contains("active"), true);
  a.element("#spellcheck-toggle").dispatch("click");
  const b = await client(service, name, t, { storage });
  assert.equal(b.editor.spellcheck, false);
  assert.equal(b.element("#spellcheck-toggle").getAttribute("aria-pressed"), "false");
});

test("editor blur preserves the pressed tab through save and lock handoff", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.addTab("other", "other text");
  await a.upsertTabState("other");
  await a.releaseTabEditing("other");
  await until(() => b.state.tabs.has("other"));
  const tabs = a.element("#tabs");
  const target = tabs.children.find((el) => el.getAttribute("data-tab-id") === "other");
  const addButton = tabs.children.find((el) => el.id === "add-tab");
  assert.ok(target);
  a.delayAck(50);
  a.input("last edit before switching");

  // Pointer-down blurs the editor before pointer-up dispatches the click.
  a.editor.dispatch("blur");
  await tick();
  assert.ok(tabs.children.includes(target), "Blur must not detach the pressed tab");
  assert.ok(tabs.children.includes(addButton), "Blur must not detach the add-tab button");
  await until(() => !a.state.releasing.has(tabId));
  assert.ok(tabs.children.includes(target), "Save/release acknowledgements must retain the click target");
  target.onclick();
  assert.equal(a.state.activeTabId, "other");
  assert.equal(a.editor.value, "other text");
  await until(() => b.state.tabs.get(tabId)?.text === "last edit before switching");
});

test("remote lock changes update tab controls without replacing their elements", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.addTab("other", "other text");
  await a.upsertTabState("other");
  await until(() => b.state.tabs.has("other"));
  const tabs = b.element("#tabs");
  const target = tabs.children.find((el) => el.getAttribute("data-tab-id") === "other");
  assert.ok(target.querySelector(".tab-edit").classList.contains("disabled"));
  assert.ok(target.querySelector(".tab-close").classList.contains("disabled"));
  await a.releaseTabEditing("other");
  await until(() => !b.state.unavailableTabs.has("other"));
  assert.ok(tabs.children.includes(target));
  assert.equal(target.querySelector(".tab-edit").classList.contains("disabled"), false);
  assert.equal(target.querySelector(".tab-close").classList.contains("disabled"), false);
  const first = tabs.children.find((el) => el.getAttribute("data-tab-id") === tabId);
  assert.ok(first.querySelector(".tab-close").classList.contains("disabled"));
  await a.requestTabLock("other");
  await until(() => b.state.unavailableTabs.has("other"));
  assert.ok(tabs.children.includes(target));
  assert.ok(target.querySelector(".tab-edit").classList.contains("disabled"));
  await a.releaseTabEditing("other");
});

test("search navigation keeps focus in search until the user chooses the editor", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.input("service one\nservice two");
  await a.upsertTabState(tabId);
  a.addTab("other", "service three");
  await a.upsertTabState("other");
  await a.releaseTabEditing("other");
  await a.releaseTabEditing(tabId);
  await until(() => b.state.tabs.has("other") && !b.editor.readOnly);
  const input = b.element("#tab-search");
  input.value = "service";
  input.focus();
  input.dispatch("input");

  const navigate = async (shiftKey, expectedTab, start) => {
    let prevented = false;
    b.focused().dispatch("keydown", { key: "Enter", shiftKey, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await tick();
    assert.equal(b.focused(), input, "Navigating must not transfer focus to the editor");
    assert.equal(b.state.activeTabId, expectedTab);
    assert.equal(currentHighlight(b)?.dataset.start, String(start));
    assert.equal(b.editor.selectionStart, b.editor.selectionEnd, "Search must not select editable text");
  };
  await navigate(false, tabId, 0);
  await navigate(false, tabId, 12);
  await navigate(false, "other", 0);
  await navigate(false, tabId, 0);
  await navigate(true, "other", 0);

  for (const id of ["#search-next", "#search-previous"]) {
    const control = b.element(id);
    control.focus();
    control.onclick();
    await tick();
    assert.equal(b.focused(), control);
  }
  const result = descendants(b.element("#search-results")).find((el) => el.className === "search-match");
  result.focus();
  await result.onclick();
  assert.equal(b.focused().dataset.searchKey, result.dataset.searchKey);
  assert.notEqual(b.focused(), b.editor);
  assert.equal(b.state.tabs.get(tabId).text, "service one\nservice two");
  assert.equal(b.state.tabs.get("other").text, "service three");
  assert.equal(b.state.dirtyTabs.size, 0);
  assert.equal(b.state.ownedLocks.size, 0);

  b.editor.focus();
  assert.equal(b.focused(), b.editor);
  input.focus();
  await b.switchTab("other");
  assert.equal(b.focused(), b.editor, "Ordinary tab switches should still focus the editor");
});

test("search updates live, navigates read-only matches, and never claims ownership", async (t) => {
  const { a, b, tabId } = await pair(t);
  const input = b.element("#tab-search");
  input.value = "service";
  input.dispatch("input");
  assert.equal(b.element("#search-summary").textContent, "0 matches in 0 tabs");
  assert.equal(b.element("#tabs").hidden, true);
  assert.equal(b.editor.value, "original");

  a.input("service one\nservice two\nservice three\nservice four");
  await a.upsertTabState(tabId);
  await until(() => b.element("#search-summary").textContent === "4 matches in 1 tab");
  const buttons = () => descendants(b.element("#search-results")).filter((el) => el.className === "search-match");
  assert.equal(buttons().length, 3);
  await buttons()[1].onclick();
  assert.equal(currentHighlight(b)?.dataset.start, "12");
  assert.equal(b.editor.selectionStart, b.editor.selectionEnd);
  assert.equal(b.editor.readOnly, true);
  assert.equal(b.element("#search-summary").textContent, "2 of 4 matches");
  b.element("#search-next").onclick();
  await until(() => currentHighlight(b)?.dataset.start === "24");
  assert.equal(b.state.ownedLocks.size, 0);
  assert.equal(b.state.dirtyTabs.size, 0);

  await a.renameTabFlow(tabId, "Service notes");
  a.input("No content matches remain");
  await a.upsertTabState(tabId);
  await until(() => b.element("#search-summary").textContent === "0 matches in 1 tab");
  assert.equal(b.element("#search-next").disabled, true);
  assert.equal(buttons().length, 0);
  b.element("#search-clear").onclick();
  assert.equal(b.element("#tabs").hidden, false);
  assert.equal(b.element("#search-results").hidden, true);
  assert.equal(input.value, "");
  assert.equal(b.element("#editor-search-highlights").hidden, true);

  input.value = "service";
  input.dispatch("input");
  await a.rotate();
  await until(() => !b.state.key);
  assert.equal(input.disabled, true);
  assert.equal(input.value, "");
  assert.equal(b.element("#search-results").hidden, true);
  assert.equal(buttons().length, 0);
  assert.equal(b.element("#editor-search-highlights").hidden, true);
});

test("search highlights preserve the caret and update without replacing matched text", async (t) => {
  const { a, b, tabId } = await pair(t);
  a.input("service one\nservice two", 3);
  await a.upsertTabState(tabId);
  const input = a.element("#tab-search");
  input.value = "service";
  input.focus();
  input.dispatch("input");
  input.dispatch("keydown", { key: "Enter", preventDefault() {} });
  await until(() => currentHighlight(a)?.dataset.start === "0");
  assert.equal(a.editor.selectionStart, 3);
  assert.equal(a.editor.selectionEnd, 3);
  const layer = a.element("#editor-search-highlights");
  assert.equal(descendants(layer).filter((el) => el.classList.contains("editor-search-match")).length, 2);
  a.editor.focus();
  const caret = a.editor.selectionStart;
  a.input(a.editor.value.slice(0, caret) + "X" + a.editor.value.slice(caret), caret + 1);
  await a.upsertTabState(tabId);
  await until(() => b.editor.value === "serXvice one\nservice two");
  assert.equal(currentHighlight(a), undefined);
  assert.equal(descendants(layer).filter((el) => el.classList.contains("editor-search-match")).length, 1);
  a.editor.scrollTop = 70;
  a.editor.scrollLeft = 25;
  a.editor.dispatch("scroll");
  assert.equal(layer.children[0].style.transform, "translate(-25px, -70px)");
  input.value = "";
  input.dispatch("input");
  assert.equal(layer.hidden, true);
  assert.equal(descendants(layer).filter((el) => el.classList.contains("editor-search-match")).length, 0);
});

test("Tab indentation preserves selection and scroll, saves, and reaches the other client", async (t) => {
  const { a, b, tabId } = await pair(t);
  const cases = [
    { text: "abc", start: 1, end: 1, expected: "a  bc", selection: [3, 3] },
    { text: "", start: 0, end: 0, expected: "  ", selection: [2, 2] },
    { text: "abc\ndef\nghi", start: 1, end: 5, expected: "  abc\n  def\nghi", selection: [3, 9] },
    { text: "abc\ndef\nghi", start: 0, end: 4, expected: "  abc\ndef\nghi", selection: [2, 6] },
    { text: "\nabc\n", start: 0, end: 5, expected: "  \n  abc\n", selection: [2, 9] },
    { text: "abc", start: 1, end: 2, expected: "  abc", selection: [3, 4] },
    { text: "  abc\n def\n\tghi\njkl", start: 0, end: 19, shiftKey: true, expected: "abc\ndef\nghi\njkl", selection: [0, 15] },
    { text: "  abc", start: 1, end: 1, shiftKey: true, expected: "abc", selection: [0, 0] },
    { text: "  abc\n  def", start: 1, end: 7, shiftKey: true, expected: "abc\ndef", selection: [0, 4] },
    { text: "  abc", start: 0, end: 1, shiftKey: true, expected: "abc", selection: [0, 0] },
    { text: "abc", start: 1, end: 1, shiftKey: true, expected: "abc", selection: [1, 1] },
  ];
  for (const c of cases) {
    a.input(c.text);
    a.editor.setSelectionRange(c.start, c.end, "backward");
    a.editor.scrollTop = 120;
    a.editor.scrollLeft = 30;
    assert.equal(pressEditorKey(a, "Tab", { shiftKey: !!c.shiftKey }), true);
    assert.equal(a.editor.value, c.expected);
    assert.deepEqual([a.editor.selectionStart, a.editor.selectionEnd], c.selection);
    assert.equal(a.editor.selectionDirection, "backward");
    assert.equal(a.editor.scrollTop, 120);
    assert.equal(a.editor.scrollLeft, 30);
    await a.upsertTabState(tabId);
    await until(() => b.editor.value === c.expected);
    assert.deepEqual([a.editor.selectionStart, a.editor.selectionEnd], c.selection);
  }
  a.input("one\ntwo");
  a.editor.setSelectionRange(0, 7);
  pressEditorKey(a);
  pressEditorKey(a);
  assert.equal(a.editor.value, "    one\n    two");
  pressEditorKey(a, "Tab", { shiftKey: true });
  assert.equal(a.editor.value, "  one\n  two");
  await a.upsertTabState(tabId);
  await until(() => b.editor.value === a.editor.value);
});

test("Tab respects read-only, composition, modifiers, and Escape keyboard navigation", async (t) => {
  const { a, b } = await pair(t);
  assert.equal(b.editor.readOnly, true);
  assert.equal(pressEditorKey(b), false);
  assert.equal(b.editor.value, "original");
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    assert.equal(pressEditorKey(a, "Tab", options), false);
    assert.equal(a.editor.value, "original");
  }
  a.editor.dispatch("compositionstart");
  assert.equal(pressEditorKey(a), false);
  a.editor.dispatch("compositionend");
  pressEditorKey(a, "Escape");
  assert.equal(pressEditorKey(a), false);
  assert.equal(a.editor.value, "original");
  assert.equal(pressEditorKey(a), true);
  await a.upsertTabState(a.state.activeTabId);
});

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
  await until(() => a.editor.value === "new owner text" && a.state.dirtyTabs.size === 0);
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
