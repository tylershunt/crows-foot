import type { Actor, SectionResult } from "../../shared/types.js";
import { titleBar } from "../lib/titlebar.js";
import { Logo } from "./Logo.js";
import { MoonIcon, SettingsIcon, SidebarIcon, SunIcon } from "./icons.js";
import { SectionMarker } from "./SectionMarker.js";

interface SidebarProps {
  viewer: Actor | null;
  sections: SectionResult[];
  theme: "light" | "dark";
  /** Narrows the sidebar to an icon rail that keeps section jumps reachable. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

/** How long the sidebar takes to change width, which every part of it moves in. */
const GLIDE = "transition-all duration-200 ease-out";

/**
 * Text that slides out from beside its icon as the sidebar narrows.
 *
 * Widening a label from nothing keeps the icon and the count it sits between in
 * one place for the whole width change, where swapping a rail's markup for a
 * sidebar's would land them somewhere new the instant it began.
 */
function slidingLabel(collapsed: boolean, expandedWidth: string): string {
  return `truncate ${GLIDE} ${collapsed ? "ml-0 max-w-0 opacity-0" : `ml-2.5 ${expandedWidth} opacity-100`}`;
}

export function Sidebar({
  viewer,
  sections,
  theme,
  collapsed,
  onToggleCollapsed,
  onToggleTheme,
  onOpenSettings,
}: SidebarProps) {
  const iconButton =
    "shrink-0 rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100";

  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900 ${GLIDE} ${
        collapsed ? "w-20" : "w-60"
      }`}
    >
      <div {...titleBar(`pb-3 ${GLIDE} ${collapsed ? "px-2" : "px-4"}`)}>
        <div className="flex items-center">
          <Logo className="h-8 w-8 shrink-0" />
          <p
            className={`wordmark-sheen bg-clip-text font-script text-2xl leading-tight text-transparent ${slidingLabel(
              collapsed,
              "max-w-40",
            )}`}
          >
            Crow&rsquo;s Foot
          </p>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (b)`}
            className={`ml-auto ${iconButton}`}
          >
            <SidebarIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pt-3">
        <p
          className={`px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500 ${GLIDE} ${
            collapsed ? "max-h-0 opacity-0" : "max-h-4 pb-1 opacity-100"
          }`}
        >
          Sections
        </p>

        {sections.map(({ config, totalCount, error }) => (
          <a
            key={config.id}
            href={`#section-${config.id}`}
            title={collapsed ? `${config.title} — ${error ? "query failed" : totalCount}` : undefined}
            className="flex items-center rounded-lg px-2 py-1.5 text-sm text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
          >
            <SectionMarker config={config} className="h-4 w-4 shrink-0 text-sm" />
            <span className={slidingLabel(collapsed, "max-w-36")}>{config.title}</span>
            <span
              className={`ml-auto shrink-0 pl-2 text-xs tabular-nums ${
                error ? "text-rose-500" : "text-ink-400 dark:text-ink-500"
              }`}
            >
              {error ? "!" : totalCount}
            </span>
          </a>
        ))}
      </nav>

      <div className="border-t border-ink-200 p-2 dark:border-ink-800">
        {viewer && (
          <a
            href={viewer.url}
            target="_blank"
            rel="noreferrer"
            title={collapsed ? viewer.login : undefined}
            className="flex items-center rounded-lg px-2 py-2 transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            <img src={viewer.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full ring-1 ring-sheen-400/40" />
            <div className={slidingLabel(collapsed, "max-w-36")}>
              <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{viewer.login}</p>
            </div>
          </a>
        )}

        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={onOpenSettings}
            title={collapsed ? "Settings" : undefined}
            className="flex min-w-0 flex-1 items-center rounded-lg px-2 py-1.5 text-xs text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
          >
            <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
            <span className={slidingLabel(collapsed, "max-w-24")}>Settings</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className={iconButton}
          >
            {theme === "dark" ? <SunIcon className="h-3.5 w-3.5" /> : <MoonIcon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
