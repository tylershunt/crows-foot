import type { PullRequest } from "../../shared/types.js";

export interface StackRow {
  pullRequest: PullRequest;
  /**
   * The pull request this one is stacked on, when that one was given.
   *
   * Two rows sharing a parent are on sibling branches: both build on it, and
   * neither builds on the other. The parent may sit in this group or among the
   * other pull requests.
   */
  parent: PullRequest | null;
  /**
   * The pull request builds on another branch, and that branch's pull request
   * was not given.
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
  /** The parent of this group is among the other pull requests. */
  parentElsewhere: boolean;
  /** A child of this group is among the other pull requests. */
  childElsewhere: boolean;
}

/**
 * Groups the pull requests that share a stack. Every input appears in exactly
 * one group.
 *
 * A pull request is stacked on another when it merges into that one's branch
 * within the same repository, which is how Graphite, `gh`, and hand-built
 * stacks all express the relationship.
 *
 * `elsewhere` holds pull requests shown apart from this list, such as the other
 * sections. They link the members of a stack they sit inside, name a parent,
 * and mark where the stack continues, and they are not grouped into it.
 *
 * Groups are ordered by their most recently updated member, newest first, and
 * keep the incoming order between equally fresh groups.
 */
export function groupIntoStacks(pullRequests: PullRequest[], elsewhere: PullRequest[] = []): StackGroup[] {
  const members = new Set(pullRequests.map((pullRequest) => pullRequest.id));
  const apart = elsewhere.filter((pullRequest) => !members.has(pullRequest.id));
  const everyone = [...pullRequests, ...apart];
  const knownParents = parentsOf([...apart, ...pullRequests]);
  const knownChildren = childrenOf(everyone, knownParents);
  const stackOf = stackIds(everyone, knownParents);

  const byStack = new Map<string, PullRequest[]>();
  for (const pullRequest of pullRequests) {
    const stack = stackOf.get(pullRequest.id)!;
    byStack.set(stack, [...(byStack.get(stack) ?? []), pullRequest]);
  }

  const groups = [...byStack.values()].map((stackMembers) => {
    const rows: StackRow[] = [];
    const visited = new Set<string>();
    const collect = (current: PullRequest) => {
      if (visited.has(current.id)) return;
      visited.add(current.id);
      if (members.has(current.id)) {
        const parent = knownParents.get(current.id) ?? null;
        rows.push({ pullRequest: current, parent, detached: !parent && current.targetsNonDefaultBranch });
      }
      for (const child of knownChildren.get(current.id) ?? []) collect(child);
    };
    for (const pullRequest of stackMembers) collect(bottomOf(pullRequest, knownParents));
    // Branches that form a cycle have no bottom to reach every member from.
    for (const pullRequest of stackMembers) collect(pullRequest);
    return withEnds(rows, knownParents, knownChildren);
  });

  return groups
    .map((group, index) => ({ group, index, freshest: freshest(group) }))
    .sort((a, b) => (a.freshest === b.freshest ? a.index - b.index : a.freshest < b.freshest ? 1 : -1))
    .map(({ group }) => group);
}

function freshest(group: StackGroup): string {
  return group.rows.reduce((latest, row) => {
    const updated = row.pullRequest.updatedAt ?? "";
    return updated > latest ? updated : latest;
  }, "");
}

/** A key shared by every pull request in the same stack, keyed by pull request id. */
function stackIds(pullRequests: PullRequest[], parents: Map<string, PullRequest>): Map<string, string> {
  const root = new Map<string, string>(pullRequests.map((pullRequest) => [pullRequest.id, pullRequest.id]));
  const find = (id: string): string => {
    let current = id;
    while (root.get(current) !== current) current = root.get(current)!;
    root.set(id, current);
    return current;
  };
  for (const [child, parent] of parents) root.set(find(child), find(parent.id));
  return new Map(pullRequests.map((pullRequest) => [pullRequest.id, find(pullRequest.id)]));
}

function withEnds(
  rows: StackRow[],
  knownParents: Map<string, PullRequest>,
  knownChildren: Map<string, PullRequest[]>,
): StackGroup {
  const members = new Set(rows.map((row) => row.pullRequest.id));
  const parent = knownParents.get(rows[0]!.pullRequest.id);
  const parentElsewhere = parent != null && !members.has(parent.id);
  const childElsewhere = rows.some((row) =>
    (knownChildren.get(row.pullRequest.id) ?? []).some((child) => !members.has(child.id)),
  );

  return { id: rows[0]!.pullRequest.id, rows, parentElsewhere, childElsewhere };
}

function childrenOf(pullRequests: PullRequest[], parents: Map<string, PullRequest>): Map<string, PullRequest[]> {
  const children = new Map<string, PullRequest[]>();
  for (const pullRequest of pullRequests) {
    const parent = parents.get(pullRequest.id);
    if (!parent) continue;
    children.set(parent.id, [...(children.get(parent.id) ?? []), pullRequest]);
  }
  return children;
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
