import type { PullRequest } from "../../shared/types.js";
import { stackBottoms } from "./stacks.js";

/** Hues held apart so two stacks on screen at once read as two, in either theme. */
const PALETTE = ["#a78bfa", "#2dd4bf", "#f5c451", "#4f8cff", "#f472b6", "#3dd68c", "#f2792b", "#a3e635"];

/**
 * The color marking the stack a pull request belongs to.
 *
 * A stack wears the color drawn for the pull request at its bottom, so its
 * members carry the same one wherever they are shown. Take every pull request
 * on the dashboard: a stack split across sections has a bottom only in the
 * whole of it.
 */
export function stackColors(pullRequests: PullRequest[]): (pullRequest: PullRequest) => string {
  const bottoms = stackBottoms(pullRequests);

  return (pullRequest) => {
    const bottom = bottoms.get(pullRequest.id) ?? pullRequest;
    return PALETTE[bottom.number % PALETTE.length]!;
  };
}
