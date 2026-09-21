import type { PullRequest } from "../../shared/types.js";

export interface StackRow {
  pullRequest: PullRequest;
  /**
   * The pull request this one is stacked on, when that one is also present.
   *
   * Two rows sharing a parent are on sibling branches: both build on it, and
   * neither builds on the other.
   */
  parent: PullRequest | null;
  /**
   * The pull request builds on another branch, but that branch's pull request is
   * not among these results, so its stack cannot be drawn.
   */
  detached: boolean;
}

/**
 * A stack, or a lone pull request when `rows` has a single entry.
 *
 * Rows are ordered parent before child. A parent may have several children, so
 * a stack is a tree rather than a chain.
 */
export interface StackGroup {
  id: string;
  rows: StackRow[];
}

/**
 * Groups pull requests that are stacked on one another, preserving the incoming
 * order otherwise. Every input appears in exactly one group.
 *
 * A pull request is stacked on another when it merges into that one's branch
 * within the same repository, which is how Graphite, `gh`, and hand-built
 * stacks all express the relationship.
 */
export function groupIntoStacks(pullRequests: PullRequest[]): StackGroup[] {
  const parents = parentsOf(pullRequests);

  const children = new Map<string, PullRequest[]>();
  for (const pullRequest of pullRequests) {
    const parent = parents.get(pullRequest.id);
    if (!parent) continue;
    children.set(parent.id, [...(children.get(parent.id) ?? []), pullRequest]);
  }

  const placed = new Set<string>();
  const collect = (current: PullRequest, rows: StackRow[]) => {
    if (placed.has(current.id)) return;
    placed.add(current.id);
    const parent = parents.get(current.id) ?? null;
    rows.push({
      pullRequest: current,
      parent,
      detached: !parent && current.targetsNonDefaultBranch,
    });
    for (const child of children.get(current.id) ?? []) collect(child, rows);
  };

  const groups: StackGroup[] = [];
  const groupFrom = (pullRequest: PullRequest) => {
    const rows: StackRow[] = [];
    collect(pullRequest, rows);
    if (rows.length > 0) groups.push({ id: pullRequest.id, rows });
  };

  for (const pullRequest of pullRequests) {
    if (!parents.has(pullRequest.id)) groupFrom(pullRequest);
  }
  // Branches that form a cycle have no top; emitting them here keeps the
  // grouping total rather than dropping pull requests from the section.
  for (const pullRequest of pullRequests) {
    if (!placed.has(pullRequest.id)) groupFrom(pullRequest);
  }

  return groups;
}

/**
 * The pull request at the bottom of each one's stack, keyed by pull request id.
 *
 * A pull request stacked on none of the others given is its own bottom, so
 * every input has an entry.
 */
export function stackBottoms(pullRequests: PullRequest[]): Map<string, PullRequest> {
  const parents = parentsOf(pullRequests);
  return new Map(pullRequests.map((pullRequest) => [pullRequest.id, bottomOf(pullRequest, parents)]));
}

/** The pull request each one is stacked on, keyed by pull request id. */
function parentsOf(pullRequests: PullRequest[]): Map<string, PullRequest> {
  const byBranch = new Map<string, PullRequest>();
  for (const pullRequest of pullRequests) {
    byBranch.set(branchKey(pullRequest.repo, pullRequest.headRef), pullRequest);
  }

  const parents = new Map<string, PullRequest>();
  for (const pullRequest of pullRequests) {
    const parent = byBranch.get(branchKey(pullRequest.repo, pullRequest.baseRef));
    if (!parent || parent.id === pullRequest.id) continue;
    parents.set(pullRequest.id, parent);
  }

  return parents;
}

/** Follows the chain down, stopping before a base/head cycle is walked twice. */
function bottomOf(pullRequest: PullRequest, parents: Map<string, PullRequest>): PullRequest {
  const seen = new Set<string>([pullRequest.id]);
  let current = pullRequest;

  for (;;) {
    const parent = parents.get(current.id);
    if (!parent || seen.has(parent.id)) return current;
    seen.add(parent.id);
    current = parent;
  }
}

function branchKey(repo: string, branch: string): string {
  return `${repo}\u0000${branch}`;
}
