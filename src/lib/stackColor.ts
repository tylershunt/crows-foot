import type { PullRequest } from "../../shared/types.js";
import { stackBottoms } from "./stacks.js";

/** Hues held apart so two stacks on screen at once read as two, in either theme. Neighbors contrast most. */
const PALETTE = ["#a78bfa", "#f5c451", "#2dd4bf", "#f472b6", "#a3e635", "#4f8cff", "#f2792b"];

/**
 * The color marking the stack a pull request belongs to.
 *
 * A stack wears the color drawn for the pull request at its bottom, so its
 * members carry the same one wherever they are shown. Take every pull request
 * on the dashboard: a stack split across sections has a bottom only in the
 * whole of it.
 *
 * Each stack starts from the hue its bottom's number picks. Stacks on the
 * dashboard never share a hue until the palette runs out: in order of bottom
 * number, a stack whose hue is taken moves to the next free one.
 */
export function stackColors(pullRequests: PullRequest[]): (pullRequest: PullRequest) => string {
  const bottoms = stackBottoms(pullRequests);
  const colors = assignColors([...new Map([...bottoms.values()].map((bottom) => [bottom.id, bottom])).values()]);

  return (pullRequest) => {
    const bottom = bottoms.get(pullRequest.id) ?? pullRequest;
    return colors.get(bottom.id) ?? preferredColor(bottom);
  };
}

function assignColors(bottoms: PullRequest[]): Map<string, string> {
  const ordered = [...bottoms].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  const taken = new Set<number>();
  const colors = new Map<string, string>();

  for (const bottom of ordered) {
    if (taken.size === PALETTE.length) taken.clear();
    let index = bottom.number % PALETTE.length;
    while (taken.has(index)) index = (index + 1) % PALETTE.length;
    taken.add(index);
    colors.set(bottom.id, PALETTE[index]!);
  }

  return colors;
}

function preferredColor(pullRequest: PullRequest): string {
  return PALETTE[pullRequest.number % PALETTE.length]!;
}
