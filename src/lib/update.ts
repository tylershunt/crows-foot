import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { notesBetween, notesFromReleaseBody, parseChangelog, type ReleaseNotes } from "./changelog.js";

export type { DownloadEvent, Update };

const CHANGELOG_AT_TAG = "https://raw.githubusercontent.com/tylershunt/crows-foot/v{version}/CHANGELOG.md";

/** The published build newer than this one, or `null` if this one is current. */
export const checkForUpdate = check;

/** Replaces this build with `update` and starts the new one. */
export async function installAndRelaunch(
  update: Update,
  onEvent?: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onEvent);
  await relaunch();
}

/**
 * The changes in every version from the running one to `update`, newest first.
 * Without the changelog at `update`'s tag, the offered release's own notes.
 */
export async function releaseNotes(update: Update): Promise<ReleaseNotes[]> {
  try {
    const response = await fetch(CHANGELOG_AT_TAG.replace("{version}", update.version));
    if (response.ok) {
      const between = notesBetween(parseChangelog(await response.text()), update.currentVersion, update.version);
      if (between.length > 0) return between;
    }
  } catch {
    // Offline or unreachable: the release body below is all there is.
  }
  const offered = notesFromReleaseBody(update.version, update.body ?? "");
  return offered.changes.length > 0 ? [offered] : [];
}
