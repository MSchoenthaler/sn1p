/* sn1p E2E client */
const $ = (s) => document.querySelector(s);

const DOC = (location.pathname.split("/").filter(Boolean).pop() || "default").toLowerCase();
document.title = `${DOC} - sn1p`;
$("#doc-name").textContent = `/${DOC}`;

const editor = $("#editor");
const printable = $("#printable");
const wrapToggleBtn = $("#wrap-toggle");
const themeToggleBtn = $("#theme-toggle");
const passwordInput = $("#password");
const unlockBtn = $("#unlock-btn");
const newPasswordInput = $("#new-password");
const applyPasswordBtn = $("#apply-password-btn");
const cancelPasswordBtn = $("#cancel-password-btn");
const changePasswordToggle = $("#change-password-toggle");
const passwordUnlockRow = $("#password-unlock-row");
const passwordChangeShell = $("#password-change-shell");
const passwordChangePanel = $("#password-change-panel");
const statusEl = $("#status");
const tabsEl = $("#tabs");
const EDIT_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="currentColor" fill-rule="evenodd" clip-rule="evenodd">
    <path d="M11.32 6.176H5c-1.105 0-2 .949-2 2.118v10.588C3 20.052 3.895 21 5 21h11c1.105 0 2-.948 2-2.118v-7.75l-3.914 4.144A2.46 2.46 0 0 1 12.81 16l-2.681.568c-1.75.37-3.292-1.263-2.942-3.115l.536-2.839c.097-.512.335-.983.684-1.352z" />
    <path d="M19.846 4.318a2.2 2.2 0 0 0-.437-.692a2 2 0 0 0-.654-.463a1.92 1.92 0 0 0-1.544 0a2 2 0 0 0-.654.463l-.546.578l2.852 3.02l.546-.579a2.1 2.1 0 0 0 .437-.692a2.24 2.24 0 0 0 0-1.635M17.45 8.721L14.597 5.7L9.82 10.76a.54.54 0 0 0-.137.27l-.536 2.84c-.07.37.239.696.588.622l2.682-.567a.5.5 0 0 0 .255-.145l4.778-5.06Z" />
  </g>
</svg>`;
const DELETE_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z" />
</svg>`;
const DELETE_CONFIRM_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="m20.37 8.91l-1 1.73l-12.13-7l1-1.73l3.04 1.75l1.36-.37l4.33 2.5l.37 1.37zM6 19V7h5.07L18 11v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2" />
</svg>`;
const WRAP_STORAGE_KEY = "sn1p-wrap-enabled";
const THEME_STORAGE_KEY = "sn1p-theme";
const WRAP_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M14.7 20.7L11 17l3.7-3.7l1.4 1.45L14.85 16h2.4q.725 0 1.238-.513T19 14.25t-.513-1.237t-1.237-.513H4v-2h13.25q1.575 0 2.663 1.088T21 14.25t-1.088 2.663T17.25 18h-2.4l1.25 1.25zM4 18v-2h5v2zM4 7V5h16v2z" />
</svg>`;
const THEME_LIGHT_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="4" stroke-linejoin="round" />
    <path stroke-linecap="round" d="M20 12h1M3 12h1m8 8v1m0-18v1m5.657 13.657l.707.707M5.636 5.636l.707.707m0 11.314l-.707.707M18.364 5.636l-.707.707" />
  </g>
</svg>`;
const THEME_DARK_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="none">
    <path d="M20.539 14.852A8 8 0 0 1 11 7c0-1.457.32-2.823 1-4a9 9 0 1 0 8.539 11.852" />
    <path stroke="currentColor" stroke-width="2" d="M20.539 14.852A8 8 0 0 1 11 7c0-1.457.32-2.823 1-4a9 9 0 1 0 8.539 11.852ZM16.625 4l.044.08l.081.045l-.08.044l-.045.081l-.044-.08l-.081-.045l.08-.044zM20.5 8.5l.177.323L21 9l-.323.177l-.177.323l-.177-.323L20 9l.323-.177z" />
  </g>
</svg>`;

function setStatus(msg, cls = "status-ok") {
  statusEl.textContent = msg;
  statusEl.className = cls;
}

function isWrapEnabled() {
  return localStorage.getItem(WRAP_STORAGE_KEY) === "1";
}

function applyWrapMode(enabled) {
  editor.classList.toggle("wrap-enabled", enabled);
  editor.wrap = enabled ? "soft" : "off";
  if (wrapToggleBtn) {
    wrapToggleBtn.classList.toggle("active", enabled);
    wrapToggleBtn.innerHTML = WRAP_ICON;
    const label = enabled ? "Disable wrap text" : "Enable wrap text";
    wrapToggleBtn.title = label;
    wrapToggleBtn.setAttribute("aria-label", label);
  }
}

function getThemePreference() {
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleBtn) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    themeToggleBtn.classList.toggle("active", theme === "light");
    themeToggleBtn.innerHTML = theme === "dark" ? THEME_LIGHT_ICON : THEME_DARK_ICON;
    const label = `Switch to ${nextTheme} mode`;
    themeToggleBtn.title = label;
    themeToggleBtn.setAttribute("aria-label", label);
  }
}

function queueSaveForTab(tabId, text) {
  if (!tabId || !canEdit()) return;
  ensureLocalTabState(tabId, { text });
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    sendUpdate(tabId, text).catch((err) => {
      console.error(err);
      setStatus("Save failed.", "status-err");
    });
  }, 450);
}

function focusEditorAtTrailingBlankLine(tabId) {
  if (!canEdit()) return;

  let nextValue = editor.value;
  if (nextValue !== "" && !nextValue.endsWith("\n")) {
    nextValue += "\n";
    editor.value = nextValue;
    queueSaveForTab(tabId, nextValue);
  }

  const caretPos = editor.value.length;
  editor.focus();
  editor.setSelectionRange(caretPos, caretPos);
}

["beforeinput", "keydown", "paste", "drop"].forEach((ev) => {
  editor.addEventListener(
    ev,
    (e) => {
      if (!state?.key) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setStatus("Enter a password to edit.", "status-warn");
      }
    },
    true
  );
});

function lockUI(locked) {
  if (locked) {
    editor.readOnly = true;
    editor.setAttribute("readonly", "readonly");
  } else {
    editor.readOnly = false;
    editor.removeAttribute("readonly");
  }
  const hint = $("#locked-hint");
  if (hint) hint.style.display = locked ? "block" : "none";
  syncPasswordUI();
  renderTabs();
  if (locked) {
    requestAnimationFrame(() => {
      if (passwordUnlockRow?.hidden) return;
      passwordInput?.focus();
      passwordInput?.select();
    });
  }
}

function canEdit() {
  return !!state.key;
}

const B64_ENCODE_CHUNK_SIZE = 0x8000 - (0x8000 % 3);

function b64enc(ab) {
  const bytes = new Uint8Array(ab);
  let out = "";

  for (let i = 0; i < bytes.length; i += B64_ENCODE_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + B64_ENCODE_CHUNK_SIZE);
    let binary = "";
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
    out += btoa(binary);
  }

  return out;
}

function b64dec(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function normalizeTabName(name) {
  return (name || "").toString().trim().slice(0, 120) || "tab";
}

const DEFAULT_TAB_NAME = "default";

function newEmptyDoc() {
  return { v: 3, kdf: null, tabs: {}, meta: { initialTabId: null } };
}

const state = {
  doc: null,
  docExists: false,
  key: null,
  authToken: null,
  kdf: null,
  activeTabId: null,
  tabs: new Map(),
  clientId: crypto.randomUUID(),
  ws: null,
  reconnectTimer: null,
  debounceTimer: null,
  pendingRename: null,
  pendingRotate: null,
  pendingDeleteTabId: null,
  editingTabId: null,
  dirtyTabs: new Set()
};

async function makeLocalKdf() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { name: "PBKDF2", hash: "SHA-256", iterations: 310000, salt: b64enc(salt) };
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function deriveAuthTokenFromPassword(pass, kdf) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const authSalt = concatBytes(enc.encode("sn1p-auth-v1:"), b64dec(kdf.salt));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: authSalt, iterations: kdf.iterations, hash: kdf.hash },
    keyMaterial,
    256
  );
  return b64enc(new Uint8Array(bits));
}

async function deriveKeyFromPassword(pass, kdf) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64dec(kdf.salt), iterations: kdf.iterations, hash: kdf.hash },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptGCM(key, plaintext) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { iv, ct: new Uint8Array(ct) };
}

async function decryptGCM(key, ivBytes, ctBytes) {
  const dec = new TextDecoder();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, ctBytes);
  return dec.decode(pt);
}

async function encryptLabel(name, key = state.key) {
  const { iv, ct } = await encryptGCM(key, name);
  return { nameIv: b64enc(iv), nameCt: b64enc(ct) };
}

async function decryptLabel(entry, key = state.key) {
  return await decryptGCM(key, b64dec(entry.nameIv), b64dec(entry.nameCt));
}

function getPersistedTabs() {
  return state.doc?.tabs || {};
}

function getInitialTabId() {
  return state.doc?.meta?.initialTabId || null;
}

function isProtectedTab(tabId) {
  return !!tabId && tabId === getInitialTabId();
}

function getAllTabIds() {
  const ids = [];
  const seen = new Set();
  for (const id of Object.keys(getPersistedTabs())) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  for (const id of state.tabs.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function ensureLocalTabState(tabId, patch = {}) {
  const existing = state.tabs.get(tabId) || { name: "", text: "", ts: 0, persisted: false };
  const next = { ...existing, ...patch };
  state.tabs.set(tabId, next);
  return next;
}

function ensureInitialTabExists() {
  if (!state.doc) state.doc = newEmptyDoc();
  if (!state.doc.meta) state.doc.meta = { initialTabId: null };

  const currentInitial = getInitialTabId();
  if (currentInitial) {
    ensureLocalTabState(currentInitial, { name: state.tabs.get(currentInitial)?.name || DEFAULT_TAB_NAME });
    if (!state.activeTabId) state.activeTabId = currentInitial;
    return currentInitial;
  }

  const ids = getAllTabIds();
  if (ids.length > 0) {
    state.doc.meta.initialTabId = ids[0];
    ensureLocalTabState(ids[0], { name: state.tabs.get(ids[0])?.name || DEFAULT_TAB_NAME });
    if (!state.activeTabId) state.activeTabId = ids[0];
    return ids[0];
  }

  const initialTabId = crypto.randomUUID();
  state.doc.meta.initialTabId = initialTabId;
  ensureLocalTabState(initialTabId, { name: DEFAULT_TAB_NAME, text: "", ts: 0, persisted: false });
  state.activeTabId = initialTabId;
  return initialTabId;
}

function removeTabLocally(tabId) {
  if (isProtectedTab(tabId)) return;
  state.dirtyTabs.delete(tabId);
  state.tabs.delete(tabId);
  if (state.doc?.tabs) delete state.doc.tabs[tabId];
  if (state.activeTabId === tabId) {
    state.activeTabId = pickNextActiveTab();
    editor.value = "";
  }
}

function pickNextActiveTab() {
  const ids = getAllTabIds();
  return ids[0] || null;
}

function currentTabState() {
  return state.activeTabId ? state.tabs.get(state.activeTabId) || null : null;
}

function getTabText(tabId) {
  if (tabId === state.activeTabId) return editor.value;
  return state.tabs.get(tabId)?.text || "";
}

function normalizePersistedText(text) {
  return text === "\n" || text === "\r\n" ? "" : text;
}

function isTabEmpty(tabId) {
  return normalizePersistedText(getTabText(tabId)) === "";
}

function shouldKeepServerDoc() {
  const ids = getAllTabIds();
  if (ids.length > 1) return true;
  return ids.some((tabId) => !isTabEmpty(tabId));
}

function getTabIdsForSync(preferTabId = null) {
  const initialTabId = getInitialTabId();
  return [...getAllTabIds()].sort((a, b) => {
    const score = (id) => {
      if (id === initialTabId) return 0;
      if (id === preferTabId) return 1;
      return 2;
    };
    return score(a) - score(b);
  });
}

async function buildEncryptedTabEntry(tabId, key = state.key, textOverride) {
  const tab = ensureLocalTabState(tabId, {});
  const text = normalizePersistedText(textOverride !== undefined ? textOverride : getTabText(tabId));
  const entry = await encryptLabel(tab.name, key);
  entry.ts = Date.now();
  if (text !== "") {
    const contentEntry = await encryptGCM(key, text);
    entry.iv = b64enc(contentEntry.iv);
    entry.ct = b64enc(contentEntry.ct);
  }
  return { entry, text };
}

async function upsertTabState(tabId, textOverride) {
  if (!state.key || !tabId) return false;

  const { entry, text } = await buildEncryptedTabEntry(tabId, state.key, textOverride);
  const payload = {
    type: "upsertTab",
    tabId,
    entry,
    clientId: state.clientId,
    kdf: state.kdf,
    auth: state.authToken,
    initialTabId: getInitialTabId(),
    totalTabCount: getAllTabIds().length
  };

  if (!sendWsMessage(payload)) {
    state.dirtyTabs.add(tabId);
    ensureLocalTabState(tabId, { text });
    return false;
  }

  if (!state.doc) state.doc = newEmptyDoc();
  state.docExists = true;
  if (!state.doc.tabs) state.doc.tabs = {};
  if (!state.doc.meta) state.doc.meta = { initialTabId: null };
  state.doc.kdf = state.kdf;
  state.doc.meta.initialTabId = getInitialTabId();
  state.doc.tabs[tabId] = entry;
  state.dirtyTabs.delete(tabId);
  ensureLocalTabState(tabId, { text, ts: entry.ts || 0, persisted: true });
  return true;
}

async function flushDirtyTabs() {
  if (!state.key || !isWsOpen() || state.dirtyTabs.size === 0) return;
  const dirtyIds = [...state.dirtyTabs];
  for (const tabId of dirtyIds) {
    if (!state.tabs.has(tabId) && !getPersistedTabs()[tabId]) {
      state.dirtyTabs.delete(tabId);
      continue;
    }
    const ok = await upsertTabState(tabId);
    if (!ok) break;
  }
}

async function syncMissingTabs(preferTabId = null) {
  if (!state.key || !shouldKeepServerDoc()) return;

  for (const tabId of getTabIdsForSync(preferTabId)) {
    const local = state.tabs.get(tabId);
    if (!local) continue;
    const hasPersistedEntry = !!getPersistedTabs()[tabId];
    if (hasPersistedEntry && local.persisted) continue;
    const ok = await upsertTabState(tabId);
    if (!ok) break;
  }
}

async function applyDocEmptied(tabId, entry, options = {}) {
  const previous = state.tabs.get(tabId) || { name: DEFAULT_TAB_NAME };
  let name = previous.name || DEFAULT_TAB_NAME;

  if (state.key && entry?.nameIv && entry?.nameCt) {
    try {
      name = await decryptLabel(entry);
    } catch {
      // keep existing label if we cannot decrypt the incoming one
    }
  }

  state.doc = newEmptyDoc();
  state.docExists = false;
  state.doc.kdf = state.kdf;
  state.doc.meta.initialTabId = tabId;
  state.tabs.clear();
  state.tabs.set(tabId, { name, text: "", ts: 0, persisted: false });
  state.activeTabId = tabId;
  editor.value = "";
  renderTabs();
  setStatus(options.fromSelf ? "Cleared." : "Cleared remotely.", options.fromSelf ? "status-ok" : "status-warn");
}

function genericLockedLabel(index) {
  return `encrypted tab ${index + 1}`;
}

function clearPlaintextState() {
  state.tabs.clear();
  state.dirtyTabs.clear();
  state.activeTabId = null;
  state.pendingDeleteTabId = null;
  state.editingTabId = null;
  editor.value = "";
  if (printable) printable.textContent = "";
}

function resetPendingDelete(render = true) {
  if (!state.pendingDeleteTabId) return;
  state.pendingDeleteTabId = null;
  if (render) renderTabs();
}

function cancelInlineRename(render = true) {
  if (!state.editingTabId) return;
  state.editingTabId = null;
  if (render) renderTabs();
}

function startInlineRename(tabId) {
  if (!canEdit()) {
    setStatus("Enter a password to rename tabs.", "status-warn");
    return;
  }
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  resetPendingDelete(false);
  state.editingTabId = tabId;
  renderTabs();
  requestAnimationFrame(() => {
    const input = tabsEl.querySelector(`[data-rename-input-for="${tabId}"]`);
    if (!input) return;
    input.focus();
    input.select();
  });
}

async function commitInlineRename(tabId, requestedName) {
  const tab = state.tabs.get(tabId);
  if (!tab) {
    cancelInlineRename();
    return;
  }

  const newName = normalizeTabName(requestedName);
  if (newName === tab.name) {
    state.editingTabId = null;
    renderTabs();
    if (!tab.persisted) {
      syncMissingTabs(tabId).catch((err) => {
        console.error(err);
        setStatus("Failed to save tab structure.", "status-err");
      });
    }
    setStatus("Tab name unchanged.", "status-ok");
    return;
  }

  state.editingTabId = null;
  await renameTabFlow(tabId, newName);
}

function closeChangePasswordPanel() {
  if (passwordChangePanel) passwordChangePanel.hidden = true;
  if (newPasswordInput) newPasswordInput.value = "";
}

function syncPasswordUI() {
  const unlocked = !!state.key;
  if (passwordUnlockRow) passwordUnlockRow.hidden = unlocked;
  if (passwordChangeShell) passwordChangeShell.hidden = !unlocked;
  if (!unlocked) closeChangePasswordPanel();
}

async function loadDoc() {
  const res = await fetch(`/api/doc/${encodeURIComponent(DOC)}`);
  if (res.status === 404) {
    state.docExists = false;
    state.doc = newEmptyDoc();
    state.kdf = await makeLocalKdf();
    state.doc.kdf = state.kdf;
    ensureInitialTabExists();
  } else if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      // ignore malformed error payloads
    }
    if (res.status === 400 && payload?.error === "Invalid document id") {
      throw new Error("Invalid document id");
    }
    throw new Error(payload?.error || `Failed to load document metadata (${res.status})`);
  } else {
    const data = await res.json();
    state.docExists = true;
    state.doc = {
      v: data.v,
      kdf: data.kdf,
      tabs: {},
      meta: data.meta || { initialTabId: null }
    };
    if (data.v !== 3) {
      setStatus("This document uses an unsupported format.", "status-err");
    } else {
      state.kdf = data.kdf;
    }
  }
  renderTabs();
  renderActiveTab();
}

function renderTabs() {
  const ids = getAllTabIds();
  tabsEl.innerHTML = "";

  ids.forEach((tabId, index) => {
    const local = state.tabs.get(tabId);
    const labelText = canEdit() ? (local?.name || `tab ${index + 1}`) : genericLockedLabel(index);
    const protectedTab = isProtectedTab(tabId);
    const armedDelete = state.pendingDeleteTabId === tabId;
    const isEditing = state.editingTabId === tabId;

    const el = document.createElement(isEditing ? "div" : "button");
    el.className = "tab" + (tabId === state.activeTabId ? " active" : "");
    if (isEditing) el.className += " editing";
    if (!canEdit()) el.className += " disabled";
    el.setAttribute("data-tab-id", tabId);
    if (!isEditing) el.type = "button";

    if (isEditing) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tab-rename-input";
      input.value = local?.name || "";
      input.setAttribute("data-rename-input-for", tabId);
      input.maxLength = 120;
      input.onclick = (ev) => ev.stopPropagation();
      input.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          ev.preventDefault();
          commitInlineRename(tabId, input.value).catch((err) => {
            console.error(err);
            setStatus("Tab rename failed.", "status-err");
          });
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancelInlineRename();
        }
      };
      input.onblur = () => {
        if (state.editingTabId !== tabId) return;
        commitInlineRename(tabId, input.value).catch((err) => {
          console.error(err);
          setStatus("Tab rename failed.", "status-err");
        });
      };
      el.appendChild(input);
    } else {
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = labelText;
      label.title = labelText;
      el.appendChild(label);
    }

    const edit = document.createElement("span");
    edit.className = "tab-edit";
    edit.innerHTML = EDIT_ICON;
    edit.title = isEditing ? "Finish renaming" : "Rename tab";
    if (!canEdit() || isEditing) edit.classList.add("disabled");
    edit.onclick = (ev) => {
      ev.stopPropagation();
      if (!canEdit() || edit.classList.contains("disabled")) return;
      startInlineRename(tabId);
    };
    el.appendChild(edit);

    const close = document.createElement("span");
    close.className = "tab-close";
    if (armedDelete) close.classList.add("armed");
    close.innerHTML = armedDelete ? DELETE_CONFIRM_ICON : DELETE_ICON;
    close.title = protectedTab ? "The first tab cannot be deleted" : armedDelete ? "Click again to delete tab" : "Delete tab";
    if (!canEdit() || protectedTab || isEditing) close.classList.add("disabled");
    close.onclick = (ev) => {
      ev.stopPropagation();
      if (!canEdit() || close.classList.contains("disabled")) return;
      if (!armedDelete) {
        state.pendingDeleteTabId = tabId;
        renderTabs();
        return;
      }
      state.pendingDeleteTabId = null;
      deleteTabFlow(tabId).catch((err) => {
        console.error(err);
        setStatus("Tab deletion failed.", "status-err");
      });
    };
    el.appendChild(close);

    el.onclick = () => {
      cancelInlineRename(false);
      if (!canEdit()) {
        setStatus("Enter a password to view tabs.", "status-warn");
        return;
      }
      switchTab(tabId).catch((err) => {
        console.error(err);
        setStatus("Failed to switch tabs.", "status-err");
      });
    };
    el.oncontextmenu = (e) => {
      e.preventDefault();
      startInlineRename(tabId);
    };

    tabsEl.appendChild(el);
  });

  const plus = document.createElement("button");
  plus.id = "add-tab";
  plus.className = "tab add";
  plus.textContent = "+ add tab";
  plus.disabled = !canEdit();
  plus.onclick = () => {
    if (!canEdit()) {
      setStatus("Enter a password to add tabs.", "status-warn");
      return;
    }
    const name = nextSuggestedTabName();
    const tabId = crypto.randomUUID();
    ensureLocalTabState(tabId, { name, text: "", ts: 0, persisted: false });
    state.activeTabId = tabId;
    state.editingTabId = tabId;
    renderTabs();
    editor.value = "";
    requestAnimationFrame(() => {
      const input = tabsEl.querySelector(`[data-rename-input-for="${tabId}"]`);
      input?.focus();
      input?.select();
    });
  };
  tabsEl.appendChild(plus);
}

function findTabIdByName(name) {
  for (const [tabId, tab] of state.tabs.entries()) {
    if (tab.name === name) return tabId;
  }
  return null;
}

function nextSuggestedTabName(baseName = "new") {
  const normalizedBase = normalizeTabName(baseName);
  if (!findTabIdByName(normalizedBase)) return normalizedBase;

  let suffix = 2;
  while (findTabIdByName(`${normalizedBase}${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBase}${suffix}`;
}

async function deleteTabFlow(tabId) {
  resetPendingDelete(false);
  if (isProtectedTab(tabId)) {
    setStatus("The first tab cannot be deleted.", "status-warn");
    return;
  }
  const local = state.tabs.get(tabId);
  if (!local?.persisted) {
    removeTabLocally(tabId);
    renderTabs();
    setStatus("Cleared.", "status-ok");
    return;
  }

  if (!sendWsMessage({ type: "deleteTab", tabId, auth: state.authToken })) {
    return;
  }
}

async function renameTabFlow(tabId, requestedName) {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  if (!canEdit()) {
    setStatus("Enter a password to rename tabs.", "status-warn");
    return;
  }

  const newName = normalizeTabName(requestedName);
  if (newName === tab.name) {
    setStatus("Tab name unchanged.", "status-ok");
    return;
  }

  const oldName = tab.name;
  ensureLocalTabState(tabId, { name: newName });
  renderTabs();

  if (!tab.persisted) {
    syncMissingTabs(tabId).catch((err) => {
      console.error(err);
      restorePendingRename();
      setStatus("Tab rename failed.", "status-err");
    });
    setStatus(`Renamed tab to "${newName}".`, "status-ok");
    return;
  }

  state.pendingRename = { tabId, oldName };
  const labelEntry = await encryptLabel(newName);
  if (!sendWsMessage({ type: "upsertTab", tabId, entry: labelEntry, auth: state.authToken })) {
    ensureLocalTabState(tabId, { name: oldName });
    state.pendingRename = null;
    renderTabs();
  } else {
    setStatus("Renaming...", "status-warn");
  }
}

function restorePendingRename() {
  const pr = state.pendingRename;
  if (!pr) return;
  ensureLocalTabState(pr.tabId, { name: pr.oldName });
  state.pendingRename = null;
  state.editingTabId = null;
  renderTabs();
}

function isWsOpen() {
  return !!state.ws && state.ws.readyState === WebSocket.OPEN;
}

function shouldReconnectWs() {
  return !!state.authToken;
}

function scheduleReconnect() {
  if (state.reconnectTimer || !shouldReconnectWs()) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (!shouldReconnectWs()) return;
    connectWs().catch(() => {
      scheduleReconnect();
    });
  }, 1000);
}

function sendWsMessage(message) {
  if (!isWsOpen()) {
    setStatus("Disconnected. Reconnecting...", "status-warn");
    scheduleReconnect();
    return false;
  }
  state.ws.send(JSON.stringify(message));
  return true;
}

async function connectWs() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/?doc=${encodeURIComponent(DOC)}`);
  state.ws = ws;

  return await new Promise((resolve) => {
    let settled = false;
    let authed = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    ws.onopen = () => {
      if (state.ws !== ws) return;
      if (!state.authToken) {
        try {
          ws.close(4001, "Missing auth");
        } catch {
          // ignore close errors
        }
        finish();
        return;
      }
      ws.send(JSON.stringify({ type: "auth", auth: state.authToken }));
    };

    ws.onclose = () => {
      if (state.ws !== ws) return;
      if (authed) {
        setStatus("Disconnected. Reconnecting...", "status-warn");
      }
      scheduleReconnect();
      finish();
    };

    ws.onerror = () => {
      if (state.ws !== ws) return;
      setStatus("WebSocket error.", "status-err");
    };

    ws.onmessage = async (ev) => {
      if (state.ws !== ws) return;
      const msg = JSON.parse(ev.data);

      if (msg.type === "authOk") {
        if (state.ws !== ws) return;
        authed = true;
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        setStatus("Connected.", "status-ok");
        flushDirtyTabs().catch((err) => {
          console.error(err);
          setStatus("Failed to sync pending changes.", "status-err");
        });
        finish();
        return;
      } else if (msg.type === "authError") {
        state.key = null;
        state.authToken = null;
        state.pendingRotate = null;
        restorePendingRename();
        clearPlaintextState();
        lockUI(true);
        if (msg.reason === "locked" && msg.lockUntil) {
          const until = new Date(msg.lockUntil);
          setStatus(`This document is temporarily locked until ${until.toLocaleTimeString()}.`, "status-err");
        } else if (msg.reason === "invalidDoc") {
          setStatus("Invalid document id.", "status-err");
        } else {
          setStatus("This session can no longer write. Re-enter the current password.", "status-err");
        }
        try {
          ws.close(4001, "Unauthorized");
        } catch {
          // ignore close errors
        }
        finish();
        return;
      } else if (msg.type === "serverError") {
        setStatus("The server hit an unexpected error. Reconnecting...", "status-err");
        if (state.ws === ws) {
          state.ws = null;
        }
        try {
          ws.close(1011, "Server error");
        } catch {
          // ignore close errors
        }
        scheduleReconnect();
        return;
      }

      if (!authed) return;

      if (msg.type === "upsertTab" || msg.type === "upsertAck") {
        if (msg.emptied) {
          await applyDocEmptied(msg.tabId, msg.entry, { fromSelf: msg.type === "upsertAck" });
          return;
        }
        await applyEncryptedTab(msg.tabId, msg.entry, {
          fromSelf: msg.type === "upsertAck",
          updateActiveContent: msg.tabId === state.activeTabId
        });
      } else if (msg.type === "deleteAck" || msg.type === "deleteTab") {
        removeTabLocally(msg.tabId);
        if (msg.emptied) {
          state.docExists = false;
          state.doc = newEmptyDoc();
          state.doc.kdf = state.kdf;
        }
        ensureInitialTabExists();
        renderTabs();
        setStatus(msg.type === "deleteAck" ? "Cleared." : "Cleared remotely.", msg.type === "deleteAck" ? "status-ok" : "status-warn");
      } else if (msg.type === "rekey") {
        const pr = state.pendingRotate;
        if (pr) {
          state.kdf = pr.newKdf;
          state.key = pr.newKey;
          state.authToken = pr.newAuthToken;
          if (!state.doc) state.doc = newEmptyDoc();
          state.doc.kdf = pr.newKdf;
          state.doc.tabs = pr.newTabs;
          state.pendingRotate = null;
          state.tabs.clear();
          ensureInitialTabExists();
          await hydrateTabsFromCipher();
          setStatus("Password updated and content re-encrypted.", "status-ok");
          lockUI(false);
          await hydrateActiveTabFromCipher();
        } else {
          state.docExists = true;
          state.kdf = msg.kdf;
          if (!state.doc) state.doc = newEmptyDoc();
          state.doc.kdf = msg.kdf;
          state.doc.tabs = msg.tabs || {};
          state.key = null;
          state.authToken = null;
          clearPlaintextState();
          setStatus("Document password changed. Enter the new password to continue.", "status-warn");
          lockUI(true);
        }
      } else if (msg.type === "rekeyAck") {
        // no-op
      } else if (msg.type === "tabError") {
        restorePendingRename();
        setStatus(msg.reason === "protectedTab" ? "The first tab cannot be deleted." : "Tab update failed.", msg.reason === "protectedTab" ? "status-warn" : "status-err");
      }
    };
  });
}

async function applyEncryptedTab(tabId, entry, options = {}) {
  if (!state.doc) state.doc = newEmptyDoc();
  if (!state.doc.tabs) state.doc.tabs = {};
  state.doc.tabs[tabId] = entry;

  const existing = state.tabs.get(tabId) || { name: "", text: "", ts: 0, persisted: true };
  const next = { ...existing, persisted: true, ts: entry.ts || existing.ts || 0 };

  if (state.key && entry.nameIv && entry.nameCt) {
    try {
      next.name = await decryptLabel(entry);
    } catch {
      next.name = existing.name || next.name || "tab";
    }
  }

  if (entry.iv && entry.ct) {
    if (options.updateActiveContent && state.key) {
      try {
        const text =
          typeof decryptAndUnpack === "function"
            ? await decryptAndUnpack(state.key, b64dec(entry.iv), b64dec(entry.ct))
            : await decryptGCM(state.key, b64dec(entry.iv), b64dec(entry.ct));
        next.text = text;
        if (tabId === state.activeTabId) editor.value = text;
      } catch {
        next.text = "";
        if (tabId === state.activeTabId) editor.value = "";
      }
    }
  } else {
    next.text = "";
    next.ts = entry.ts || 0;
    if (tabId === state.activeTabId) editor.value = "";
  }

  state.tabs.set(tabId, next);
  if (!state.activeTabId) state.activeTabId = tabId;
  if (!getInitialTabId()) state.doc.meta.initialTabId = tabId;
  renderTabs();

  if (!options.fromSelf && tabId === state.activeTabId && state.key) {
    setStatus(`Updated from another client (${next.name || "tab"}).`, "status-warn");
  } else if (options.fromSelf && state.pendingRename?.tabId === tabId) {
    state.pendingRename = null;
    setStatus(`Renamed tab to "${next.name}".`, "status-ok");
  }
}

function anyCipherTabEntry() {
  const tabs = getPersistedTabs();
  for (const id of Object.keys(tabs)) {
    const entry = tabs[id];
    if (entry && entry.iv && entry.ct) return [id, entry];
  }
  return null;
}

async function tryDecryptWithKey(key, entry) {
  try {
    const iv = b64dec(entry.iv);
    const ct = b64dec(entry.ct);
    const text =
      typeof decryptAndUnpack === "function"
        ? await decryptAndUnpack(key, iv, ct)
        : await decryptGCM(key, iv, ct);
    return { ok: true, text };
  } catch {
    return { ok: false };
  }
}

async function tryDecryptLabelWithKey(key, entry) {
  try {
    await decryptLabel(entry, key);
    return true;
  } catch {
    return false;
  }
}

async function canKeyOpenPersistedTabs(key) {
  const tabs = Object.values(getPersistedTabs());
  for (const entry of tabs) {
    if (!entry?.nameIv || !entry?.nameCt) return false;
    const labelOk = await tryDecryptLabelWithKey(key, entry);
    if (!labelOk) return false;
    if (entry.iv && entry.ct) {
      const contentOk = await tryDecryptWithKey(key, entry);
      if (!contentOk.ok) return false;
    }
  }
  return true;
}

async function hydrateTabsFromCipher() {
  if (!state.key) return;
  const tabs = getPersistedTabs();
  for (const [tabId, entry] of Object.entries(tabs)) {
    try {
      const name = await decryptLabel(entry);
      const existing = state.tabs.get(tabId) || { text: "", ts: entry.ts || 0 };
      state.tabs.set(tabId, { ...existing, name, text: entry.iv && entry.ct ? existing.text || "" : "", ts: entry.ts || 0, persisted: true });
    } catch {
      // keep going; wrong password check already happened before hydrate
    }
  }
  if (!state.activeTabId) state.activeTabId = pickNextActiveTab();
  ensureInitialTabExists();
  renderTabs();
}

function firstExistingTabId() {
  ensureInitialTabExists();
  const ids = getAllTabIds();
  if (state.activeTabId && ids.includes(state.activeTabId)) return state.activeTabId;
  return ids[0] || null;
}

async function hydrateActiveTabFromCipher() {
  if (!state.key) return;
  const tabId = firstExistingTabId();
  state.activeTabId = tabId;
  if (!tabId) {
    editor.value = "";
    renderTabs();
    return;
  }

  const slot = getPersistedTabs()[tabId];
  if (!slot) {
    editor.value = state.tabs.get(tabId)?.text || "";
    renderTabs();
    return;
  }

  if (!slot.iv || !slot.ct) {
    ensureLocalTabState(tabId, { text: "", ts: slot.ts || 0, persisted: true });
    editor.value = "";
    renderTabs();
    return;
  }

  try {
    const text =
      typeof decryptAndUnpack === "function"
        ? await decryptAndUnpack(state.key, b64dec(slot.iv), b64dec(slot.ct))
        : await decryptGCM(state.key, b64dec(slot.iv), b64dec(slot.ct));
    ensureLocalTabState(tabId, { text, ts: slot.ts || 0, persisted: true });
    editor.value = text;
  } catch {
    setStatus("Wrong password.", "status-err");
    editor.value = "";
  }

  renderTabs();
}

function renderActiveTab() {
  const tab = currentTabState();
  editor.value = tab?.text || "";
}

async function unlockWithPassword() {
  const newPass = passwordInput.value.trim();
  if (!newPass) {
    setStatus("Enter a password first.", "status-warn");
    lockUI(true);
    return;
  }
  if (state.doc?.v && state.doc.v !== 3) {
    setStatus("This document uses an unsupported format.", "status-err");
    lockUI(true);
    return;
  }

  const testKey = await deriveKeyFromPassword(newPass, state.kdf);
  const testAuthToken = await deriveAuthTokenFromPassword(newPass, state.kdf);

  if (state.docExists) {
    const res = await fetch(`/api/doc/${encodeURIComponent(DOC)}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth: testAuthToken })
    });

    if (!res.ok) {
      state.key = null;
      state.authToken = null;
      clearPlaintextState();
      lockUI(true);

      let payload = null;
      try {
        payload = await res.json();
      } catch {
        // ignore malformed error payloads
      }

      if (payload?.reason === "locked" && payload.lockUntil) {
        const until = new Date(payload.lockUntil);
        setStatus(`This document is temporarily locked until ${until.toLocaleTimeString()}.`, "status-err");
      } else {
        setStatus("Wrong password.", "status-err");
      }
      return;
    }

    const payload = await res.json();
    state.docExists = true;
    state.doc = payload.doc;
    state.kdf = payload.doc.kdf;
    const ok = await canKeyOpenPersistedTabs(testKey);
    if (!ok) {
      state.key = null;
      state.authToken = null;
      clearPlaintextState();
      setStatus("Wrong password.", "status-err");
      lockUI(true);
      return;
    }
  }

  state.key = testKey;
  state.authToken = testAuthToken;
  connectWs().catch((err) => {
    console.error(err);
    scheduleReconnect();
  });
  passwordInput.value = "";
  await hydrateTabsFromCipher();
  await hydrateActiveTabFromCipher();
  setStatus("Key ready.", "status-ok");
  lockUI(false);
  focusEditorAtTrailingBlankLine(state.activeTabId);
}

async function changePassword() {
  const newPass = newPasswordInput.value.trim();
  if (!newPass) {
    setStatus("Enter a new password first.", "status-warn");
    return;
  }
  if (!state.key) {
    setStatus("Unlock the document before changing the password.", "status-warn");
    lockUI(true);
    return;
  }

  const persistedIds = Object.keys(getPersistedTabs());
  if (persistedIds.length > 0) {
    const okOld = await canKeyOpenPersistedTabs(state.key);
    if (!okOld) {
      setStatus("Cannot change password: current session key can't decrypt. Reload and enter the correct password first.", "status-err");
      state.key = null;
      state.authToken = null;
      clearPlaintextState();
      lockUI(true);
      return;
    }
  }

  const newKdf = await makeLocalKdf();
  const newKey = await deriveKeyFromPassword(newPass, newKdf);
  const newAuthToken = await deriveAuthTokenFromPassword(newPass, newKdf);
  const newTabs = {};

  if (persistedIds.length === 0 && !shouldKeepServerDoc()) {
    state.kdf = newKdf;
    state.key = newKey;
    state.authToken = newAuthToken;
    if (!state.doc) state.doc = newEmptyDoc();
    state.doc.kdf = newKdf;
    closeChangePasswordPanel();
    setStatus("Password updated.", "status-ok");
    return;
  }

  for (const [tabId, entry] of Object.entries(getPersistedTabs())) {
    const local = state.tabs.get(tabId);
    const name = local?.name || await decryptLabel(entry, state.key);
    const nameEncrypted = await encryptLabel(name, newKey);

    if (entry.iv && entry.ct) {
      const decrypted = await tryDecryptWithKey(state.key, entry);
      if (!decrypted.ok) {
        setStatus("Password change aborted: could not re-encrypt all tabs.", "status-err");
        return;
      }
      const text = tabId === state.activeTabId ? editor.value : decrypted.text;
      const contentEncrypted =
        typeof packAndEncrypt === "function"
          ? await packAndEncrypt(newKey, text)
          : await encryptGCM(newKey, text);

      newTabs[tabId] = {
        ...nameEncrypted,
        iv: b64enc(contentEncrypted.iv),
        ct: b64enc(contentEncrypted.ct),
        ts: entry.ts || Date.now()
      };
    } else {
      newTabs[tabId] = { ...nameEncrypted, ts: entry.ts || Date.now() };
    }
  }

  state.pendingRotate = { newKdf, newKey, newTabs, newAuthToken };
  if (sendWsMessage({ type: "rotateKdf", kdf: newKdf, tabs: newTabs, auth: state.authToken, nextAuth: newAuthToken, initialTabId: getInitialTabId() })) {
    closeChangePasswordPanel();
    setStatus("Updating password...", "status-warn");
  } else {
    state.pendingRotate = null;
    setStatus("Password update is waiting for reconnection.", "status-warn");
  }
}

unlockBtn.addEventListener("click", () => {
  unlockWithPassword().catch((err) => {
    console.error(err);
    setStatus("Failed to unlock document.", "status-err");
  });
});

passwordInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    unlockBtn.click();
  }
});

changePasswordToggle.addEventListener("click", () => {
  const isOpen = !passwordChangePanel.hidden;
  passwordChangePanel.hidden = isOpen;
  if (!isOpen) {
    newPasswordInput.focus();
  } else {
    closeChangePasswordPanel();
  }
});

applyPasswordBtn.addEventListener("click", () => {
  changePassword().catch((err) => {
    console.error(err);
    setStatus("Failed to update password.", "status-err");
  });
});

cancelPasswordBtn.addEventListener("click", () => {
  closeChangePasswordPanel();
});

newPasswordInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    applyPasswordBtn.click();
  }
});

wrapToggleBtn.addEventListener("click", () => {
  const next = !editor.classList.contains("wrap-enabled");
  localStorage.setItem(WRAP_STORAGE_KEY, next ? "1" : "0");
  applyWrapMode(next);
});

themeToggleBtn.addEventListener("click", () => {
  const next = getThemePreference() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

async function sendUpdate(tabId, text) {
  if (!state.key || !tabId) return;
  const ok = await upsertTabState(tabId, text);
  if (!ok) return;
  await syncMissingTabs(tabId);
  setStatus("Saved.", "status-ok");
}

editor.addEventListener("input", () => {
  if (!canEdit()) {
    setStatus("Enter a password to edit.", "status-warn");
    return;
  }
  if (!state.activeTabId) {
    setStatus("Add a tab before editing.", "status-warn");
    editor.value = "";
    return;
  }
  const tabId = state.activeTabId;
  const text = editor.value;
  ensureLocalTabState(tabId, { text });
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    sendUpdate(tabId, text).catch((err) => {
      console.error(err);
      setStatus("Save failed.", "status-err");
    });
  }, 450);
});

async function switchTab(tabId) {
  resetPendingDelete(false);
  cancelInlineRename(false);
  state.activeTabId = tabId;
  renderTabs();
  const local = state.tabs.get(tabId);
  const slot = getPersistedTabs()[tabId];
  if (slot && state.key && slot.iv && slot.ct) {
    try {
      const text =
        typeof decryptAndUnpack === "function"
          ? await decryptAndUnpack(state.key, b64dec(slot.iv), b64dec(slot.ct))
          : await decryptGCM(state.key, b64dec(slot.iv), b64dec(slot.ct));
      ensureLocalTabState(tabId, { text, ts: slot.ts || 0, persisted: true });
      editor.value = text;
    } catch {
      setStatus("Unable to decrypt this tab with your password.", "status-err");
      editor.value = "";
    }
  } else {
    editor.value = slot ? "" : local?.text || "";
    if (slot) ensureLocalTabState(tabId, { text: "", ts: slot.ts || 0, persisted: true });
  }
  focusEditorAtTrailingBlankLine(tabId);
}

document.addEventListener("click", (ev) => {
  if (ev.target.closest("#add-tab")) return;
  if (ev.target.closest(".tab-close")) return;
  resetPendingDelete();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") resetPendingDelete();
});

applyTheme(getThemePreference());
applyWrapMode(isWrapEnabled());
lockUI(true);
loadDoc()
  .then(() => lockUI(!canEdit()))
  .catch((err) => {
    console.error(err);
    setStatus(err?.message || "Failed to load document.", "status-err");
  });
