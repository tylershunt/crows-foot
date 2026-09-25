import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest } from "../../shared/types.js";
import { groupIntoStacks } from "./stacks.js";

function pullRequest(
  id: string,
  headRef: string,
  baseRef: string,
  repo = "o/r",
  defaultBranch = "main",
): PullRequest {
  return {
    id,
    headRef,
    baseRef,
    repo,
    targetsNonDefaultBranch: baseRef !== defaultBranch,
    title: id,
  } as unknown as PullRequest;
}

/** Each row as `id` or `id<-parentId`, suffixed with `!` when flagged as detached. */
function shape(pullRequests: PullRequest[]): string[][] {
  return groupIntoStacks(pullRequests).map((group) =>
    group.rows.map(
      (row) =>
        `${row.pullRequest.id}${row.parent ? `<-${row.parent.id}` : ""}${row.detached ? "!" : ""}`,
    ),
  );
}

test("a stack is emitted from its base upwards, whatever order it arrives in", () => {
  const rows = shape([
    pullRequest("c", "c", "b"),
    pullRequest("a", "a", "main"),
    pullRequest("b", "b", "a"),
  ]);

  assert.deepEqual(rows, [["a", "b<-a", "c<-b"]]);
});

test("two pull requests on the same parent name that parent, not each other", () => {
  const rows = shape([
    pullRequest("root", "root", "main"),
    pullRequest("x", "x", "root"),
    pullRequest("y", "y", "root"),
  ]);

  assert.deepEqual(rows, [["root", "x<-root", "y<-root"]]);
});

test("a pull request stacked on an absent parent is flagged rather than grouped", () => {
  assert.deepEqual(shape([pullRequest("lone", "lone", "someone-elses-branch")]), [["lone!"]]);
});

test("a pull request targeting the default branch is an ordinary row", () => {
  assert.deepEqual(shape([pullRequest("plain", "plain", "main")]), [["plain"]]);
});

test("equally named branches in different repositories are unrelated", () => {
  const rows = shape([
    pullRequest("p", "shared", "main", "o/one"),
    pullRequest("q", "other", "shared", "o/two"),
  ]);

  assert.deepEqual(rows, [["p"], ["q!"]]);
});

function ends(pullRequests: PullRequest[], elsewhere: PullRequest[] = []) {
  return groupIntoStacks(pullRequests, elsewhere).map((group) => ({
    rows: group.rows.map(
      (row) =>
        `${row.pullRequest.id}${row.parent ? `<-${row.parent.id}` : ""}${row.detached ? "!" : ""}`,
    ),
    parentElsewhere: group.parentElsewhere,
    childElsewhere: group.childElsewhere,
  }));
}

test("a pull request stacked on one in another section names that parent and stays open above", () => {
  const parent = pullRequest("a", "a", "main");
  const child = pullRequest("b", "b", "a");

  assert.deepEqual(ends([child], [parent]), [
    { rows: ["b<-a"], parentElsewhere: true, childElsewhere: false },
  ]);
});

test("a pull request whose child is in another section stays open below", () => {
  const parent = pullRequest("a", "a", "main");
  const child = pullRequest("b", "b", "a");

  assert.deepEqual(ends([parent], [child]), [
    { rows: ["a"], parentElsewhere: false, childElsewhere: true },
  ]);
});

test("a pull request between members in other sections is open at both ends", () => {
  const bottom = pullRequest("a", "a", "main");
  const middle = pullRequest("b", "b", "a");
  const top = pullRequest("c", "c", "b");

  assert.deepEqual(ends([middle], [bottom, top]), [
    { rows: ["b<-a"], parentElsewhere: true, childElsewhere: true },
  ]);
});

test("a run of a stack is open where the other sections hold the rest", () => {
  const bottom = pullRequest("a", "a", "main");
  const middle = pullRequest("b", "b", "a");
  const top = pullRequest("c", "c", "b");
  const above = pullRequest("d", "d", "c");

  assert.deepEqual(ends([middle, top], [bottom, above]), [
    { rows: ["b<-a", "c<-b"], parentElsewhere: true, childElsewhere: true },
  ]);
});

test("two pull requests stacked on a parent in another section each name that parent", () => {
  const parent = pullRequest("a", "a", "main");
  const left = pullRequest("b", "b", "a");
  const right = pullRequest("c", "c", "a");

  assert.deepEqual(ends([left, right], [parent]), [
    { rows: ["b<-a"], parentElsewhere: true, childElsewhere: false },
    { rows: ["c<-a"], parentElsewhere: true, childElsewhere: false },
  ]);
});

test("a stack held in one section stays closed beside an unrelated pull request", () => {
  const parent = pullRequest("a", "a", "main");
  const child = pullRequest("b", "b", "a");

  assert.deepEqual(ends([parent, child], [pullRequest("z", "z", "main")]), [
    { rows: ["a", "b<-a"], parentElsewhere: false, childElsewhere: false },
  ]);
});

test("an equally named branch in another repository does not open the bracket", () => {
  assert.deepEqual(
    ends([pullRequest("q", "other", "shared", "o/two")], [pullRequest("p", "shared", "main", "o/one")]),
    [{ rows: ["q!"], parentElsewhere: false, childElsewhere: false }],
  );
});

test("every pull request is grouped exactly once, including a base/head cycle", () => {
  const input = [
    pullRequest("a", "a", "main"),
    pullRequest("b", "b", "a"),
    pullRequest("orphan", "orphan", "gone"),
    pullRequest("m", "m", "n"),
    pullRequest("n", "n", "m"),
  ];

  const ids = shape(input)
    .flat()
    .map((row) => row.replace(/[<!].*$/, ""));

  assert.deepEqual(ids.slice().sort(), ["a", "b", "m", "n", "orphan"]);
});
