import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest } from "../../shared/types.js";
import { hueDistance, stackColors } from "./stackColor.js";

function pullRequest(number: number, headRef: string, baseRef: string, repo = "o/r"): PullRequest {
  return { id: `pr-${repo}-${number}`, number, headRef, baseRef, repo, title: headRef } as unknown as PullRequest;
}

test("every member of a stack is marked in one color", () => {
  const bottom = pullRequest(1, "one", "main");
  const middle = pullRequest(2, "two", "one");
  const top = pullRequest(3, "three", "two");
  const color = stackColors([bottom, middle, top]);

  assert.equal(color(middle), color(bottom));
  assert.equal(color(top), color(bottom));
});

test("sibling branches on one parent are marked as the one stack they are", () => {
  const bottom = pullRequest(1, "one", "main");
  const left = pullRequest(2, "left", "one");
  const right = pullRequest(3, "right", "one");
  const color = stackColors([bottom, left, right]);

  assert.equal(color(left), color(bottom));
  assert.equal(color(right), color(bottom));
});

test("a stack is marked the same whichever order its members arrive in", () => {
  const bottom = pullRequest(1, "one", "main");
  const top = pullRequest(2, "two", "one");

  assert.equal(stackColors([top, bottom])(top), stackColors([bottom, top])(top));
});

test("a stack whose bottom is absent is marked as its own", () => {
  const top = pullRequest(2, "two", "one");

  assert.equal(stackColors([top])(top), stackColors([top, pullRequest(9, "nine", "main")])(top));
});

test("consecutively numbered stacks are told apart", () => {
  const first = pullRequest(1, "one", "main");
  const second = pullRequest(2, "two", "main");
  const color = stackColors([first, second]);

  assert.notEqual(color(first), color(second));
});
test("stacks whose numbers pick the same hue are told apart", () => {
  const first = pullRequest(1, "one", "main");
  const second = pullRequest(1 + 8 * 8, "two", "main");
  const color = stackColors([first, second]);

  assert.notEqual(color(first), color(second));
});

test("no two stacks share a color while the palette has one free", () => {
  const stacks = Array.from({ length: 8 }, (_, index) => pullRequest(index * 8, `b${index}`, "main"));
  const color = stackColors(stacks);

  assert.equal(new Set(stacks.map(color)).size, stacks.length);
});

test("two stacks sit at least a third of the color wheel apart, whatever their numbers", () => {
  for (let first = 1; first <= 16; first++) {
    for (let second = first + 1; second <= 17; second++) {
      const a = pullRequest(first, `a${first}`, "main");
      const b = pullRequest(second, `b${second}`, "main");
      const color = stackColors([a, b]);
      assert.ok(hueDistance(color(a), color(b)) >= 120, `#${first} and #${second}`);
    }
  }
});

test("three stacks each sit at least a sixth of the color wheel from the others", () => {
  const stacks = [pullRequest(4, "a", "main"), pullRequest(5, "b", "main"), pullRequest(12, "c", "main")];
  const color = stackColors(stacks);
  for (const one of stacks) {
    for (const other of stacks) {
      if (one !== other) assert.ok(hueDistance(color(one), color(other)) >= 60);
    }
  }
});
