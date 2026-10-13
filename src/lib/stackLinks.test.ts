import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest } from "../../shared/types.js";
import { markdownLinkList } from "./stackLinks.js";

function pullRequest(number: number, title: string): PullRequest {
  return { number, title, url: `https://github.com/o/r/pull/${number}` } as unknown as PullRequest;
}

test("each pull request is a bullet linking its number and title, in the order given", () => {
  assert.equal(
    markdownLinkList([pullRequest(2, "Add the model"), pullRequest(3, "Expose it")]),
    "- [#2 Add the model](https://github.com/o/r/pull/2)\n- [#3 Expose it](https://github.com/o/r/pull/3)",
  );
});

test("brackets and backslashes in a title stay inside the link text", () => {
  assert.equal(
    markdownLinkList([pullRequest(4, "[WIP] a\\b")]),
    "- [#4 \\[WIP\\] a\\\\b](https://github.com/o/r/pull/4)",
  );
});
