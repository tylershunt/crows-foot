import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Opens a link in the browser the user is signed in to GitHub with. */
export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

/** Puts a link on the system clipboard as plain text. */
export async function copyLink(url: string): Promise<void> {
  await writeText(url);
}

/**
 * Whether following `href` from `from` would land on a different page, rather
 * than somewhere within the one already open.
 */
export function leavesTheDocument(href: string, from: string): boolean {
  const target = new URL(href, from);
  const here = new URL(from);

  return target.origin !== here.origin || target.pathname !== here.pathname || target.search !== here.search;
}

/**
 * Routes clicks on links that leave the dashboard to the browser, for the
 * lifetime of the returned unsubscribe. Links to a place within the dashboard
 * are left to scroll there as they would on any page.
 *
 * The dashboard owns the only web view in the app and has no address bar of its
 * own, so a page followed in place would strand the user with no way back.
 */
export function sendLinksToTheBrowser(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;

    const href = event.target.closest("a")?.href;
    if (!href || !/^https?:/i.test(href) || !leavesTheDocument(href, location.href)) return;

    event.preventDefault();
    void openExternal(href);
  };

  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
