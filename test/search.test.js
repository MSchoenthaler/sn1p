import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../public/search.js", import.meta.url), "utf8");
const find = runInNewContext(source + "\nfindTabMatches");
const search = (tabs, query) => JSON.parse(JSON.stringify(find(tabs, query)));

test("content-first search groups all occurrences, line numbers, and name-only matches", () => {
  const tabs = [
    { id: "a", name: "Notes", text: "Service service\nsecond\nSERVICE" },
    { id: "b", name: "Service accounts", text: "Unrelated body" },
    { id: "c", name: "Other", text: "Nothing here" },
  ];
  const groups = search(tabs, "service");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].matches.map(({ start, end, line }) => [start, end, line]), [[0, 7, 1], [8, 15, 1], [23, 30, 3]]);
  assert.equal(groups[1].nameMatch, true);
  assert.equal(groups[1].matches.length, 0);
  assert.deepEqual(search(tabs, ""), []);
  assert.deepEqual(search(tabs, "absent"), []);
});

test("search escapes regex punctuation and preserves original Unicode offsets", () => {
  const text = "\u0130 \ud83d\ude00 [a.*] $() \\ service SERVICE";
  for (const query of ["[a.\\*]", "$()", "\\", "service", "\ud83d\ude00"]) {
    const [group] = search([{ id: "a", name: "a", text }], query);
    assert.ok(group.matches.length);
    for (const match of group.matches) assert.equal(text.slice(match.start, match.end), match.hit);
  }
  const matches = search([{ id: "a", name: "a", text }], "service")[0].matches;
  assert.equal(matches[0].start, text.indexOf("service"));
  assert.equal(matches.length, 2);
});

test("wildcards span lines, stop at the nearest continuation, and preserve line numbers", () => {
  const text = "before\nSELECT\n  id, name\nFROM users;\nselectfrom;\nselect * from other;";
  const matches = search([{ id: "a", name: "SQL", text }], "select*from")[0].matches;
  assert.deepEqual(matches.map(({ hit, line }) => [hit, line]), [
    ["SELECT\n  id, name\nFROM", 2], ["selectfrom", 5], ["select * from", 6],
  ]);
  for (const match of matches) assert.equal(text.slice(match.start, match.end), match.hit);
  assert.deepEqual(search([{ id: "a", name: "SQL", text }], "select***from"),
    search([{ id: "a", name: "SQL", text }], "select*from"));
});

test("question marks match one Unicode character including newlines", () => {
  const text = "ab aXb a\ud83d\ude00b a\nb aXXb";
  const matches = search([{ id: "a", name: "", text }], "a?b")[0].matches;
  assert.deepEqual(matches.map(({ hit }) => hit), ["aXb", "a\ud83d\ude00b", "a\nb"]);
  for (const match of matches) assert.equal(text.slice(match.start, match.end), match.hit);
});

test("escapes distinguish literal SQL stars, question marks, and backslashes", () => {
  const tabs = [{ id: "a", name: "", text: "select * from; select id from; what? C:\\notes\\file \\* end\\" }];
  for (const [query, hits] of [
    [String.raw`select \* from`, ["select * from"]],
    [String.raw`what\?`, ["what?"]],
    [String.raw`C:\notes\file`, ["C:\\notes\\file"]],
    [String.raw`C:\\notes\\file`, ["C:\\notes\\file"]],
    [String.raw`\\\*`, ["\\*"]],
    ["end\\", ["end\\"]],
  ]) assert.deepEqual(search(tabs, query)[0].matches.map(({ hit }) => hit), hits, query);
});

test("wildcards work in tab names and ignore empty-only matches", () => {
  const tabs = [{ id: "a", name: "Select users from DB", text: "" },
    { id: "b", name: "", text: "select id from table" }];
  const groups = search(tabs, "select*from");
  assert.deepEqual(groups.map(({ id }) => id), ["b", "a"]);
  assert.equal(groups[1].nameMatch, true);
  assert.deepEqual(search(tabs, "***"), []);
  assert.deepEqual(search(tabs, "?missing"), []);
  assert.deepEqual(search([{ id: "c", name: "", text: "xxend startyy" }], "*end")[0].matches.map(({ hit }) => hit), ["xxend"]);
  assert.deepEqual(search([{ id: "c", name: "", text: "startyy" }], "start*")[0].matches.map(({ hit }) => hit), ["start"]);
});

test("many wildcard segments fail without combinatorial backtracking", () => {
  const tabs = [{ id: "a", name: "", text: "a".repeat(50000) }];
  assert.deepEqual(search(tabs, "a*".repeat(30) + "missing"), []);
});

test("snippets stay on the matching line and bound long-line context", () => {
  const text = "preceding\n" + "x".repeat(100) + "needle" + "y".repeat(100) + "\nfollowing";
  const match = search([{ id: "a", name: "a", text }], "needle")[0].matches[0];
  assert.equal(match.line, 2);
  assert.equal(match.before, "..." + "x".repeat(32));
  assert.equal(match.after, "y".repeat(48) + "...");
});
