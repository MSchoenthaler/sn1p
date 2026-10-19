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

test("search is literal and preserves original Unicode offsets", () => {
  const text = "\u0130 \ud83d\ude00 [a.*] $() \\ service SERVICE";
  for (const query of ["[a.*]", "$()", "\\", "service", "\ud83d\ude00"]) {
    const [group] = search([{ id: "a", name: "a", text }], query);
    assert.ok(group.matches.length);
    for (const match of group.matches) assert.equal(text.slice(match.start, match.end), match.hit);
  }
  const matches = search([{ id: "a", name: "a", text }], "service")[0].matches;
  assert.equal(matches[0].start, text.indexOf("service"));
  assert.equal(matches.length, 2);
});

test("snippets stay on the matching line and bound long-line context", () => {
  const text = "preceding\n" + "x".repeat(100) + "needle" + "y".repeat(100) + "\nfollowing";
  const match = search([{ id: "a", name: "a", text }], "needle")[0].matches[0];
  assert.equal(match.line, 2);
  assert.equal(match.before, "..." + "x".repeat(32));
  assert.equal(match.after, "y".repeat(48) + "...");
});
