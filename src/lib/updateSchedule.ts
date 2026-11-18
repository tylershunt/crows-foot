/** How often a running app looks for a newer release. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The least time between two looks, so focusing the window often does not ask GitHub each time. */
export const UPDATE_CHECK_MIN_GAP_MS = 10 * 60 * 1000;

/** Whether a look is due: none has been made, or the last began at least `minimumGapMs` before `now`. */
export function updateCheckDue(lastCheckAt: number | null, now: number, minimumGapMs: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= minimumGapMs;
}

/**
 * Whether to offer the release a look found: one other than the release
 * already offered, and other than the one the user dismissed.
 */
export function offersFound(foundVersion: string, shownVersion: string | null, dismissedVersion: string | null): boolean {
  return foundVersion !== shownVersion && foundVersion !== dismissedVersion;
}
