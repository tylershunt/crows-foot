import assert from "node:assert/strict";
import { test } from "node:test";
import { MOSS_REACH, mossTufts, MOSS_SHADES, type Overgrowth, overgrowth } from "./overgrowth.js";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-07T12:00:00Z");
const updatedDaysAgo = (days: number) => new Date(now - days * DAY).toISOString();

test("a pull request updated within the last week is not overgrown", () => {
  assert.equal(overgrowth(updatedDaysAgo(0), now), 0);
  assert.equal(overgrowth(updatedDaysAgo(6.9), now), 0);
});

test("overgrowth starts a week after the last update", () => {
  assert.equal(overgrowth(updatedDaysAgo(7), now), 1);
});

test("overgrowth reaches stages two, three, and four at two, four, and eight weeks", () => {
  assert.equal(overgrowth(updatedDaysAgo(14), now), 2);
  assert.equal(overgrowth(updatedDaysAgo(28), now), 3);
  assert.equal(overgrowth(updatedDaysAgo(56), now), 4);
  assert.equal(overgrowth(updatedDaysAgo(3650), now), 4);
});

test("overgrowth never recedes as a pull request sits longer", () => {
  let previous = 0;
  for (let days = 0; days <= 120; days += 0.5) {
    const stage = overgrowth(updatedDaysAgo(days), now);
    assert.ok(stage >= previous, `stage fell at ${days} days`);
    previous = stage;
  }
});

const stages: Overgrowth[] = [0, 1, 2, 3, 4];

test("a pull request updated within the last week grows no moss", () => {
  assert.deepEqual(mossTufts("PR_a", 0), []);
});

test("each later stage grows more moss", () => {
  for (const seed of ["PR_a", "PR_b", "PR_kwDOabc123"]) {
    const counts = stages.map((stage) => mossTufts(seed, stage).length);
    for (let index = 1; index < counts.length; index += 1) assert.ok(counts[index]! > counts[index - 1]!);
  }
});

test("one pull request grows the same moss on every render", () => {
  for (const stage of stages) assert.deepEqual(mossTufts("PR_a", stage), mossTufts("PR_a", stage));
});

test("two pull requests grow different moss", () => {
  assert.notDeepEqual(mossTufts("PR_a", 3), mossTufts("PR_b", 3));
});

test("each later stage's moss reaches farther across the row", () => {
  for (let index = 1; index < stages.length; index += 1) {
    assert.ok(MOSS_REACH[stages[index]!] > MOSS_REACH[stages[index - 1]!]);
  }
  assert.equal(MOSS_REACH[4], 100);
});

test("moss tufts grow only as far as the moss reaches, in the palette's shades", () => {
  for (const seed of ["PR_a", "PR_b", "x"]) {
    for (const stage of stages) {
      for (const tuft of mossTufts(seed, stage)) {
        assert.ok(tuft.left >= 0 && tuft.left <= MOSS_REACH[stage]);
        assert.ok(tuft.size > 0);
        assert.ok(Number.isInteger(tuft.shade) && tuft.shade >= 0 && tuft.shade < MOSS_SHADES);
      }
    }
  }
});
