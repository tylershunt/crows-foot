import type { DashboardResponse } from "../../shared/types.js";

/** A refreshed dashboard, and why each section it shows from an earlier fetch was not updated. */
export interface Refreshed {
  dashboard: DashboardResponse;
  /** The error that kept each section from updating, keyed by section id. */
  stale: Record<string, string>;
}

/**
 * `next`, with each section that failed in `next` but answered the same query
 * in `previous` shown with the pull requests `previous` held. A section whose
 * query changed shows its failure.
 */
export function keepLastGood(previous: DashboardResponse | null, next: DashboardResponse): Refreshed {
  const stale: Record<string, string> = {};
  const sections = next.sections.map((section) => {
    const before = previous?.sections.find((earlier) => earlier.config.id === section.config.id);
    if (section.error === null || !before || before.error !== null || before.config.query !== section.config.query) {
      return section;
    }
    stale[section.config.id] = section.error;
    return { ...before, config: section.config };
  });
  return { dashboard: { ...next, sections }, stale };
}
