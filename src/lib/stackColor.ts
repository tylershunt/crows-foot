import type { PullRequest } from "../../shared/types.js";
import { stackBottoms } from "./stacks.js";

/** A stack color and its hue in degrees, which spacing stacks apart is measured in. */
interface Swatch {
  color: string;
  hue: number;
}

/** Bright enough to read on either theme, and none violet, which the unread marker wears. */
const PALETTE: Swatch[] = [
  { color: "#f87171", hue: 0 },
  { color: "#fb923c", hue: 27 },
  { color: "#f5c451", hue: 45 },
  { color: "#a3e635", hue: 83 },
  { color: "#34d399", hue: 158 },
  { color: "#22d3ee", hue: 189 },
  { color: "#4f8cff", hue: 220 },
  { color: "#f472b6", hue: 330 },
];

/**
 * The color marking the stack a pull request belongs to.
 *
 * A stack wears the color drawn for the pull request at its bottom, so its
 * members carry the same one wherever they are shown. Take every pull request
 * on the dashboard: a stack split across sections has a bottom only in the
 * whole of it.
 *
 * In order of bottom number, the first stack takes the hue its number picks,
 * and each after it takes the free hue farthest from every hue already taken.
 * Two stacks sit on opposite sides of the color wheel, and stacks share a hue
 * only once the palette runs out.
 */
export function stackColors(pullRequests: PullRequest[]): (pullRequest: PullRequest) => string {
  const bottoms = stackBottoms(pullRequests);
  const colors = assignColors([...new Map([...bottoms.values()].map((bottom) => [bottom.id, bottom])).values()]);

  return (pullRequest) => {
    const bottom = bottoms.get(pullRequest.id) ?? pullRequest;
    return colors.get(bottom.id) ?? preferred(bottom).color;
  };
}

/** The distance between two hues around the color wheel, from 0 to 180. */
export function hueDistance(a: string, b: string): number {
  const hue = (color: string) => PALETTE.find((swatch) => swatch.color === color)?.hue ?? 0;
  const apart = Math.abs(hue(a) - hue(b)) % 360;
  return Math.min(apart, 360 - apart);
}

function assignColors(bottoms: PullRequest[]): Map<string, string> {
  const ordered = [...bottoms].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  let taken: Swatch[] = [];
  const colors = new Map<string, string>();

  for (const bottom of ordered) {
    if (taken.length === PALETTE.length) taken = [];
    const swatch = taken.length === 0 ? preferred(bottom) : farthestFrom(taken);
    taken.push(swatch);
    colors.set(bottom.id, swatch.color);
  }

  return colors;
}

/** The free swatch whose nearest taken hue is farthest away, earliest in the palette on a tie. */
function farthestFrom(taken: Swatch[]): Swatch {
  let best: Swatch | null = null;
  let bestGap = -1;
  for (const swatch of PALETTE) {
    if (taken.includes(swatch)) continue;
    const gap = Math.min(...taken.map((held) => hueDistance(held.color, swatch.color)));
    if (gap > bestGap) {
      best = swatch;
      bestGap = gap;
    }
  }
  return best!;
}

function preferred(pullRequest: PullRequest): Swatch {
  return PALETTE[pullRequest.number % PALETTE.length]!;
}
