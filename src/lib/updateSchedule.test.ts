import assert from "node:assert/strict";
import { test } from "node:test";
import { offersFound, updateCheckDue } from "./updateSchedule.js";

test("the first look is always due", () => {
  assert.equal(updateCheckDue(null, 1_000, 600_000), true);
});

test("a look is due once the gap since the last one has passed", () => {
  assert.equal(updateCheckDue(1_000, 1_000 + 599_999, 600_000), false);
  assert.equal(updateCheckDue(1_000, 1_000 + 600_000, 600_000), true);
});

test("a newly found release is offered", () => {
  assert.equal(offersFound("0.14.0", null, null), true);
});

test("a release newer than the one already offered replaces it", () => {
  assert.equal(offersFound("0.14.0", "0.13.0", null), true);
});

test("the release already offered is not offered again", () => {
  assert.equal(offersFound("0.13.0", "0.13.0", null), false);
});

test("a dismissed release stays dismissed until a newer one is found", () => {
  assert.equal(offersFound("0.13.0", null, "0.13.0"), false);
  assert.equal(offersFound("0.14.0", null, "0.13.0"), true);
});
