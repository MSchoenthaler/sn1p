/* Local search over unlocked tab names and content. */
function compileSearchQuery(query) {
  const parts = [""];
  const characters = Array.from(query);
  for (let i = 0; i < characters.length; i++) {
    let character = characters[i];
    if (character === "\\" && ["*", "?", "\\"].includes(characters[i + 1])) {
      character = characters[++i];
    } else if (character === "*") {
      if (parts[parts.length - 1] || parts.length === 1) parts.push("");
      continue;
    } else if (character === "?") {
      parts[parts.length - 1] += "[\\s\\S]";
      continue;
    }
    parts[parts.length - 1] += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return parts.map((part) => new RegExp(part, "giu"));
}

function* findSearchMatches(text, parts) {
  if (parts.every((part) => part.source === "(?:)")) return;
  let cursor = 0;
  while (cursor <= text.length) {
    let start = cursor;
    // Each part has fixed character width. Finding successive earliest matches
    // gives a shortest match without backtracking across multiple wildcards.
    for (let i = 0; i < parts.length; i++) {
      parts[i].lastIndex = cursor;
      const match = parts[i].exec(text);
      if (!match) return;
      if (i === 0) start = match.index;
      cursor = match.index + match[0].length;
    }
    yield { index: start, 0: text.slice(start, cursor) };
  }
}

function findTabMatches(tabs, query) {
  if (!query) return [];
  const parts = compileSearchQuery(query);
  const groups = [];
  for (const tab of tabs) {
    const matches = [];
    let line = 1;
    let lineStart = 0;
    let newline = tab.text.indexOf("\n");
    for (const match of findSearchMatches(tab.text, parts)) {
      while (newline !== -1 && newline < match.index) {
        line++;
        lineStart = newline + 1;
        newline = tab.text.indexOf("\n", lineStart);
      }
      const start = match.index;
      const end = start + match[0].length;
      const lineEnd = tab.text.indexOf("\n", end);
      const from = Math.max(lineStart, start - 32);
      const to = Math.min(lineEnd === -1 ? tab.text.length : lineEnd, end + 48);
      matches.push({ tabId: tab.id, start, end, line,
        before: (from > lineStart ? "..." : "") + tab.text.slice(from, start),
        hit: match[0], after: tab.text.slice(end, to) + (to < (lineEnd === -1 ? tab.text.length : lineEnd) ? "..." : "") });
    }
    const nameMatch = !findSearchMatches(tab.name, parts).next().done;
    if (matches.length || nameMatch) groups.push({ ...tab, matches, nameMatch });
  }
  return groups.sort((a, b) => Number(b.matches.length > 0) - Number(a.matches.length > 0));
}

function createEditorSearchHighlights(editor, layer) {
  const mirror = document.createElement("div");
  mirror.className = "editor-search-mirror";
  layer.appendChild(mirror);
  let signature = "";

  function syncScroll() {
    mirror.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  }

  function syncLayout() {
    const style = getComputedStyle(editor);
    layer.style.left = `${editor.offsetLeft}px`;
    layer.style.top = `${editor.offsetTop}px`;
    layer.style.width = `${editor.clientWidth}px`;
    layer.style.height = `${editor.clientHeight}px`;
    mirror.style.width = `${editor.clientWidth}px`;
    for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
      "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "whiteSpace", "overflowWrap", "wordBreak"]) {
      mirror.style[property] = style[property];
    }
    syncScroll();
  }

  function update(matches, selected) {
    const text = editor.value;
    const nextSignature = JSON.stringify([text, matches.map(({ start, end }) => [start, end]), selected?.start]);
    layer.hidden = matches.length === 0;
    if (signature !== nextSignature) {
      signature = nextSignature;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of matches) {
        fragment.appendChild(document.createTextNode(text.slice(offset, match.start)));
        const mark = document.createElement("mark");
        mark.className = "editor-search-match";
        if (selected?.tabId === match.tabId && selected.start === match.start) mark.classList.add("current");
        mark.dataset.start = String(match.start);
        mark.textContent = text.slice(match.start, match.end);
        fragment.appendChild(mark);
        offset = match.end;
      }
      // Keep a trailing empty line the same height as the textarea's last line.
      fragment.appendChild(document.createTextNode(matches.length ? text.slice(offset) + "\n" : ""));
      mirror.replaceChildren(fragment);
    }
    syncLayout();
  }

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncLayout).observe(editor);
  return { update, syncScroll };
}

function createTabSearch({ getTabs, isUnlocked, selectMatch, onError, onChange = () => {} }) {
  const input = document.querySelector("#tab-search");
  const clear = document.querySelector("#search-clear");
  const results = document.querySelector("#search-results");
  const controls = document.querySelector("#search-controls");
  const summary = document.querySelector("#search-summary");
  const previous = document.querySelector("#search-previous");
  const next = document.querySelector("#search-next");
  const tabsEl = document.querySelector("#tabs");
  const expanded = new Set();
  let groups = [];
  let matches = [];
  let selected = null;
  let lastTabs = [];
  let lastQuery = null;
  let timer;

  function currentIndex() {
    return selected ? matches.findIndex((match) => match.tabId === selected.tabId && match.start === selected.start) : -1;
  }

  function updateSummary() {
    const index = currentIndex();
    summary.textContent = index >= 0 ? `${index + 1} of ${matches.length} matches`
      : `${matches.length} ${matches.length === 1 ? "match" : "matches"} in ${groups.length} ${groups.length === 1 ? "tab" : "tabs"}`;
    previous.disabled = next.disabled = matches.length === 0;
  }

  async function openMatch(match) {
    refresh();
    const current = matches.find((item) => item.tabId === match.tabId && item.start === match.start && item.hit === match.hit);
    if (!current) return;
    selected = current;
    if (groups.find((group) => group.id === current.tabId).matches.indexOf(current) >= 3) expanded.add(current.tabId);
    render();
    await selectMatch(current.tabId, current);
  }

  function navigate(direction) {
    refresh();
    if (!matches.length) return;
    const index = currentIndex();
    const target = index < 0 ? (direction > 0 ? 0 : matches.length - 1)
      : (index + direction + matches.length) % matches.length;
    openMatch(matches[target]).catch(onError);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function render() {
    const focusedKey = document.activeElement?.dataset?.searchKey;
    let restoreFocus;
    const fragment = document.createDocumentFragment();
    if (!groups.length) fragment.appendChild(node("p", "search-empty", "No matches"));
    for (const group of groups) {
      const section = node("section", "search-group");
      const heading = node("button", "search-tab");
      heading.type = "button";
      heading.title = group.name;
      heading.appendChild(node("span", "search-tab-name", group.name));
      heading.appendChild(node("span", "search-count", group.matches.length ? String(group.matches.length) : "Name match"));
      heading.dataset.searchKey = group.id;
      heading.onclick = () => {
        if (group.matches.length) return openMatch(group.matches[0]).catch(onError);
        selected = null;
        render();
        return selectMatch(group.id, null).catch(onError);
      };
      section.appendChild(heading);
      if (focusedKey === heading.dataset.searchKey) restoreFocus = heading;
      const visible = expanded.has(group.id) ? group.matches : group.matches.slice(0, 3);
      for (const match of visible) {
        const compactHit = match.hit.replace(/[\r\n]+/g, " ");
        const previewHit = compactHit.length > 96 ? compactHit.slice(0, 96) + "..." : compactHit;
        const preview = `${match.before}${previewHit}${match.after}`;
        const button = node("button", "search-match");
        button.type = "button";
        button.dataset.searchKey = `${group.id}:${match.start}`;
        button.setAttribute("aria-label", `${group.name}, line ${match.line}: ${preview}`);
        if (selected?.tabId === match.tabId && selected.start === match.start) button.setAttribute("aria-current", "true");
        button.appendChild(node("span", "search-line", String(match.line)));
        const snippet = node("span", "search-snippet");
        snippet.appendChild(node("span", "", match.before));
        snippet.appendChild(node("mark", "", previewHit));
        snippet.appendChild(node("span", "", match.after));
        button.appendChild(snippet);
        button.title = preview;
        button.onclick = () => openMatch(match).catch(onError);
        section.appendChild(button);
        if (focusedKey === button.dataset.searchKey) restoreFocus = button;
      }
      if (group.matches.length > 3) {
        const more = node("button", "search-more", expanded.has(group.id) ? "Show fewer" : `Show ${group.matches.length - 3} more`);
        more.type = "button";
        more.dataset.searchKey = `${group.id}:more`;
        more.onclick = () => {
          if (expanded.has(group.id)) expanded.delete(group.id); else expanded.add(group.id);
          render();
        };
        section.appendChild(more);
        if (focusedKey === more.dataset.searchKey) restoreFocus = more;
      }
      fragment.appendChild(section);
    }
    results.replaceChildren(fragment);
    updateSummary();
    onChange();
    if (focusedKey) (restoreFocus || input).focus({ preventScroll: true });
  }

  function refresh() {
    clearTimeout(timer);
    const unlocked = isUnlocked();
    input.disabled = !unlocked;
    if (!unlocked) input.value = "";
    const query = input.value;
    const tabs = query ? getTabs() : [];
    tabsEl.hidden = !!query;
    results.hidden = controls.hidden = !query;
    clear.hidden = !query;
    if (query === lastQuery && tabs.length === lastTabs.length && tabs.every((tab, index) =>
      tab.id === lastTabs[index].id && tab.name === lastTabs[index].name && tab.text === lastTabs[index].text)) return;
    if (query !== lastQuery) { selected = null; expanded.clear(); }
    lastQuery = query;
    lastTabs = tabs;
    groups = findTabMatches(tabs, query);
    matches = groups.flatMap((group) => group.matches);
    if (currentIndex() < 0) selected = null;
    render();
  }

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
    if (event.key === "Escape") { input.value = ""; refresh(); }
  });
  clear.onclick = () => { input.value = ""; refresh(); input.focus(); };
  previous.onclick = () => navigate(-1);
  next.onclick = () => navigate(1);
  return {
    refresh,
    getHighlights(tabId, text) {
      const matches = findTabMatches([{ id: tabId, name: "", text }], lastQuery || "")[0]?.matches || [];
      const selectedMatch = selected?.tabId === tabId && lastTabs.find((tab) => tab.id === tabId)?.text === text ? selected : null;
      return { matches, selected: selectedMatch };
    },
    scheduleRefresh() { clearTimeout(timer); timer = setTimeout(refresh, 120); }
  };
}
