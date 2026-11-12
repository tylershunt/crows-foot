import assert from "node:assert/strict";
import { test } from "node:test";
import { RefreshHold } from "./refreshHold.js";

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

test("the hold is released before any click", () => {
  assert.equal(new RefreshHold(10_000, clock().now).remaining(), 0);
});

test("a click holds for the quiet period, counted from the last click", () => {
  const time = clock();
  const hold = new RefreshHold(10_000, time.now);
  hold.click();
  time.advance(6_000);
  assert.equal(hold.remaining(), 4_000);
  hold.click();
  time.advance(6_000);
  assert.equal(hold.remaining(), 4_000);
  time.advance(4_000);
  assert.equal(hold.remaining(), 0);
});

test("an open popover holds until every popover closes", () => {
  const hold = new RefreshHold(10_000, clock().now);
  const closeMenu = hold.openPopover();
  const closePicker = hold.openPopover();
  assert.equal(hold.remaining(), Infinity);
  closeMenu();
  closeMenu();
  assert.equal(hold.remaining(), Infinity);
  closePicker();
  assert.equal(hold.remaining(), 0);
});

test("released resolves when the last popover closes", async () => {
  const hold = new RefreshHold(10_000, clock().now);
  const close = hold.openPopover();
  let released = false;
  const waiting = hold.released().then(() => (released = true));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(released, false);
  close();
  await waiting;
  assert.equal(released, true);
});

test("released resolves once the quiet period after a click passes", async () => {
  const hold = new RefreshHold(20);
  hold.click();
  const started = Date.now();
  await hold.released();
  assert.ok(Date.now() - started >= 15);
});
