const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/**
 * How overgrown a pull request is: 0 for one updated within the last week, then
 * 1 from one week, 2 from two, 3 from four, and 4 from eight weeks untouched.
 */
export type Overgrowth = 0 | 1 | 2 | 3 | 4;

const STAGE_STARTS_IN_WEEKS = [1, 2, 4, 8] as const;

export function overgrowth(updatedAt: string, now: number = Date.now()): Overgrowth {
  const idle = now - new Date(updatedAt).getTime();
  return STAGE_STARTS_IN_WEEKS.filter((weeks) => idle >= weeks * WEEK).length as Overgrowth;
}

export interface MossTuft {
  /** Distance from the row's left edge, as a percentage of its width. */
  left: number;
  /** Width in pixels; the tuft is half as tall. */
  size: number;
  /** Index into the moss palette. */
  shade: number;
}

const TUFTS_AT_STAGE: Record<Overgrowth, number> = { 0: 0, 1: 6, 2: 14, 3: 28, 4: 48 };

/** How far the moss along the bottom edge reaches across the row at each stage, in percent. */
export const MOSS_REACH: Record<Overgrowth, number> = { 0: 0, 1: 30, 2: 50, 3: 75, 4: 100 };

export const MOSS_SHADES = 4;

/**
 * The moss tufts along a row's bottom edge, placed the same way every time for
 * one `seed` and stage. Each later stage has more tufts, reaching farther across.
 */
export function mossTufts(seed: string, stage: Overgrowth): MossTuft[] {
  const random = seededRandom(seed);
  const tufts: MossTuft[] = [];

  for (let index = 0; index < TUFTS_AT_STAGE[4]; index += 1) {
    const tuft = { position: random(), size: 10 + Math.round(random() * 12), shade: Math.floor(random() * MOSS_SHADES) };
    if (index >= TUFTS_AT_STAGE[stage]) continue;
    tufts.push({ left: tuft.position * MOSS_REACH[stage], size: tuft.size, shade: tuft.shade });
  }
  return tufts;
}

/** A deterministic generator of numbers in [0, 1) for one seed (mulberry32). */
function seededRandom(seed: string): () => number {
  let state = 0;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 0x9e3779b1);
  }

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
