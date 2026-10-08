import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, inlineSpans, notesBetween, notesFromReleaseBody, parseChangelog } from "./changelog.js";

const changelog = `# Changelog

Each section is a release's notes.

## 0.11.0

## 0.10.2

- Rows keep their height when a pull request
  becomes a draft.
- The **Copy link** button confirms.

## 0.10.1

- The list spans the window.

## 0.9.0

- Snooze.
`;

test("each version section lists its bullets, with wrapped lines joined", () => {
  const notes = parseChangelog(changelog);
  assert.deepEqual(
    notes.map((entry) => entry.version),
    ["0.11.0", "0.10.2", "0.10.1", "0.9.0"],
  );
  assert.deepEqual(notes[1]!.changes, [
    "Rows keep their height when a pull request becomes a draft.",
    "The **Copy link** button confirms.",
  ]);
});

test("prose outside a version section is not a change", () => {
  assert.equal(
    parseChangelog(changelog).some((entry) => entry.changes.some((change) => change.includes("release's notes"))),
    false,
  );
});

test("an update shows every version after the installed one up to the offered one, newest first", () => {
  const between = notesBetween(parseChangelog(changelog), "0.9.0", "0.10.2");
  assert.deepEqual(
    between.map((entry) => entry.version),
    ["0.10.2", "0.10.1"],
  );
});

test("a version with no changes is not shown", () => {
  const between = notesBetween(parseChangelog(changelog), "0.10.2", "0.11.0");
  assert.deepEqual(between, []);
});

test("versions compare by number, not by text", () => {
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("0.10.1", "0.10.1"), 0);
});

test("a release body's changes end where its headed sections begin", () => {
  const body = "- One change.\n- Another\n  wrapped.\n\n### Installing\n\n- Not a change.";
  assert.deepEqual(notesFromReleaseBody("0.10.2", body), {
    version: "0.10.2",
    changes: ["One change.", "Another wrapped."],
  });
});

test("strong text and code are told apart from plain text", () => {
  assert.deepEqual(inlineSpans("Use **Copy reviewers** or `gh auth login` now"), [
    { kind: "text", text: "Use " },
    { kind: "strong", text: "Copy reviewers" },
    { kind: "text", text: " or " },
    { kind: "code", text: "gh auth login" },
    { kind: "text", text: " now" },
  ]);
});
