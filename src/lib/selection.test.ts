import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest, SectionResult } from "../../shared/types.js";
import { allAuthoredBy, requestedOnAll, selectedPullRequests } from "./selection.js";

function pullRequest(id: string, author: string | null = "crow", requestedReviewers: string[] = []): PullRequest {
  return { id, author: author ? { login: author } : null, requestedReviewers } as unknown as PullRequest;
}

function section(...pullRequests: PullRequest[]): SectionResult {
  return { pullRequests } as unknown as SectionResult;
}

const ids = (pullRequests: PullRequest[]) => pullRequests.map((one) => one.id);

test("selected pull requests come in dashboard order, each once across sections", () => {
  const sections = [section(pullRequest("a"), pullRequest("b")), section(pullRequest("c"), pullRequest("a"))];

  assert.deepEqual(ids(selectedPullRequests(sections, new Set(["c", "a"]))), ["a", "c"]);
});

test("a selected id no longer on the dashboard is left out", () => {
  assert.deepEqual(ids(selectedPullRequests([section(pullRequest("a"))], new Set(["a", "gone"]))), ["a"]);
});

test("pull requests are all the viewer's only when the viewer wrote each one", () => {
  assert.equal(allAuthoredBy([pullRequest("a"), pullRequest("b")], "crow"), true);
  assert.equal(allAuthoredBy([pullRequest("a"), pullRequest("b", "raven")], "crow"), false);
  assert.equal(allAuthoredBy([pullRequest("a", null)], "crow"), false);
  assert.equal(allAuthoredBy([pullRequest("a")], null), false);
  assert.equal(allAuthoredBy([], "crow"), false);
});

test("a reviewer counts as requested only when requested on every pull request", () => {
  const requested = requestedOnAll([
    pullRequest("a", "crow", ["rook", "jay"]),
    pullRequest("b", "crow", ["jay", "magpie"]),
  ]);

  assert.deepEqual([...requested], ["jay"]);
});
