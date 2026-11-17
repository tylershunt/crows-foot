import type { PullRequest, SectionResult } from "../../shared/types.js";

/** The selected pull requests, each once, in the order the dashboard lists them. */
export function selectedPullRequests(sections: SectionResult[], selectedIds: ReadonlySet<string>): PullRequest[] {
  const found = new Map<string, PullRequest>();
  for (const section of sections) {
    for (const pullRequest of section.pullRequests) {
      if (selectedIds.has(pullRequest.id) && !found.has(pullRequest.id)) found.set(pullRequest.id, pullRequest);
    }
  }
  return [...found.values()];
}

/** Whether `login` wrote every one of the pull requests, of which there is at least one. */
export function allAuthoredBy(pullRequests: PullRequest[], login: string | null): boolean {
  return (
    login !== null &&
    pullRequests.length > 0 &&
    pullRequests.every((pullRequest) => pullRequest.author?.login === login)
  );
}

/** The reviewers already requested on every one of the pull requests. */
export function requestedOnAll(pullRequests: PullRequest[]): Set<string> {
  const [first, ...rest] = pullRequests;
  if (!first) return new Set();
  return new Set(
    first.requestedReviewers.filter((reviewer) => rest.every((other) => other.requestedReviewers.includes(reviewer))),
  );
}
