import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { DownloadEvent, Update };

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
