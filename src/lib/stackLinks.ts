import type { PullRequest } from "../../shared/types.js";

/**
 * A Markdown bullet list linking each pull request, in the order given, as
 * `- [#number title](url)`.
 */
export function markdownLinkList(pullRequests: PullRequest[]): string {
  return pullRequests
    .map((pullRequest) => `- [#${pullRequest.number} ${linkText(pullRequest.title)}](${pullRequest.url})`)
    .join("\n");
}

function linkText(title: string): string {
  return title.replace(/[\\[\]]/g, (character) => `\\${character}`);
}
