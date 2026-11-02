import assert from "node:assert/strict";
import { test } from "node:test";
import type { DashboardResponse, PullRequest, SectionResult } from "../../shared/types.js";
import { keepLastGood } from "./lastGood.js";

function section(id: string, query: string, rows: string[], error: string | null = null): SectionResult {
  return {
    config: { id, title: id, query, limit: 25, collapsed: false, color: "#fff", countsTowardBadge: false },
    pullRequests: rows.map((row) => ({ id: row }) as unknown as PullRequest),
    totalCount: rows.length,
    countIsPartial: false,
    error,
  };
}

function dashboard(...sections: SectionResult[]): DashboardResponse {
  return { viewer: { login: "crow", avatarUrl: "", url: "" }, sections };
}

const ids = (result: DashboardResponse) => result.sections.map((one) => one.pullRequests.map((row) => row.id));

test("a section that fails after answering the same query keeps its last rows and is marked stale", () => {
  const previous = dashboard(section("mine", "author:@me", ["a", "b"]));
  const next = dashboard(section("mine", "author:@me", [], "Could not reach GitHub"));

  const refreshed = keepLastGood(previous, next);

  assert.deepEqual(ids(refreshed.dashboard), [["a", "b"]]);
  assert.equal(refreshed.dashboard.sections[0]!.error, null);
  assert.deepEqual(refreshed.stale, { mine: "Could not reach GitHub" });
});

test("a section stays stale across repeated failures", () => {
  const first = keepLastGood(
    dashboard(section("mine", "author:@me", ["a"])),
    dashboard(section("mine", "author:@me", [], "down")),
  );
  const second = keepLastGood(first.dashboard, dashboard(section("mine", "author:@me", [], "still down")));

  assert.deepEqual(ids(second.dashboard), [["a"]]);
  assert.deepEqual(second.stale, { mine: "still down" });
});

test("a section whose query changed shows its failure", () => {
  const refreshed = keepLastGood(
    dashboard(section("mine", "author:@me", ["a"])),
    dashboard(section("mine", "author:@me size:", [], "`size:` takes a number")),
  );

  assert.equal(refreshed.dashboard.sections[0]!.error, "`size:` takes a number");
  assert.deepEqual(refreshed.stale, {});
});

test("a section that answers replaces what it held", () => {
  const refreshed = keepLastGood(
    dashboard(section("mine", "author:@me", ["a"])),
    dashboard(section("mine", "author:@me", ["c"])),
  );

  assert.deepEqual(ids(refreshed.dashboard), [["c"]]);
  assert.deepEqual(refreshed.stale, {});
});

test("a first fetch that fails shows the failure", () => {
  const refreshed = keepLastGood(null, dashboard(section("mine", "author:@me", [], "down")));

  assert.equal(refreshed.dashboard.sections[0]!.error, "down");
});
