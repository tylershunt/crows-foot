import type { PullRequest, SectionResult } from "../../shared/types.js";
import { SNOOZED_SECTION } from "../../shared/snoozed.js";
import { AlertIcon, ChevronDownIcon, FeatherIcon, FlameIcon, SettingsIcon, StackIcon } from "./icons.js";
import { groupIntoStacks } from "../lib/stacks.js";
import { PullRequestRow } from "./PullRequestRow.js";
import { SectionMarker } from "./SectionMarker.js";

interface SectionProps {
  section: SectionResult;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  /** Receives the section's pull requests in the order shown here. */
  onBurnDown: (pullRequests: PullRequest[]) => void;
  onToggleSnooze: (pullRequest: PullRequest, snoozed: boolean) => void;
  /** The color marking the stack a pull request belongs to, across all sections. */
  stackColor: (pullRequest: PullRequest) => string;
  /** Draws skeleton rows while a fetch is in flight and no results are cached yet. */
  loading: boolean;
}

export function Section({
  section,
  collapsed,
  onToggle,
  onEdit,
  onBurnDown,
  onToggleSnooze,
  stackColor,
  loading,
}: SectionProps) {
  const { config, pullRequests, totalCount, countIsPartial, error } = section;
  const hiddenCount = totalCount - pullRequests.length;
  const groups = groupIntoStacks(pullRequests);
  const ordered = groups.flatMap((group) => group.rows.map((row) => row.pullRequest));
  const snoozed = config.id === SNOOZED_SECTION.id;

  return (
    <section id={`section-${config.id}`} className="scroll-mt-24">
      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
        <header className="group flex items-center gap-2.5 border-b border-ink-200 px-4 py-2.5 dark:border-ink-800">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <ChevronDownIcon
              className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            />
            <SectionMarker config={config} glow className="h-4 w-4 shrink-0 text-sm" />
            <h2 className="truncate text-sm font-semibold text-ink-900 dark:text-ink-100">{config.title}</h2>
            <span
              title={
                countIsPartial
                  ? `At least ${totalCount}: this section's query is answered partly here, over the first ${config.limit} GitHub returned`
                  : undefined
              }
              className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium tabular-nums text-ink-600 dark:bg-ink-800 dark:text-ink-300"
            >
              {totalCount}
              {countIsPartial && "+"}
            </span>
          </button>

          {!snoozed && (
            <button
              type="button"
              onClick={onEdit}
              title="Edit this section's filter"
              className="rounded-md p-1.5 text-ink-400 opacity-0 transition hover:bg-ink-100 hover:text-ink-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onBurnDown(ordered)}
            disabled={ordered.length === 0}
            title={`Burn down: open all ${ordered.length} in new tabs`}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-orange-500/10 hover:text-orange-500 disabled:pointer-events-none disabled:opacity-30"
          >
            <FlameIcon className="h-4 w-4" />
          </button>
        </header>

        {!collapsed && (
          <div>
            {error ? (
              <div className="flex items-start gap-2 px-4 py-4 text-sm text-rose-600 dark:text-rose-400">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">This query failed.</p>
                  <p className="mt-0.5 text-xs opacity-80">{error}</p>
                </div>
              </div>
            ) : loading && pullRequests.length === 0 ? (
              <SkeletonRows />
            ) : pullRequests.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-7 text-ink-400 dark:text-ink-500">
                <FeatherIcon className="h-5 w-5 opacity-50" />
                <p className="text-sm">Nothing in this section.</p>
              </div>
            ) : (
              <>
                {groups.map((group) => {
                  const color = stackColor(group.rows[0]!.pullRequest);

                  return group.rows.length === 1 ? (
                    <PullRequestRow
                      key={group.id}
                      pr={group.rows[0]!.pullRequest}
                      snoozed={snoozed}
                      onToggleSnooze={onToggleSnooze}
                      homeSection={section.homeSections?.[group.rows[0]!.pullRequest.id]}
                      detached={group.rows[0]!.detached}
                      stackColor={color}
                    />
                  ) : (
                    <div key={group.id} className="relative">
                      <span
                        role="img"
                        aria-label={`Stack of ${group.rows.length} pull requests`}
                        className="pointer-events-none absolute left-[4px] top-px z-10"
                        style={{ color, opacity: 0.8 }}
                      >
                        <StackIcon className="h-3 w-3" />
                      </span>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-2.5 left-[9px] top-[14px] z-10 w-2 border-y-2 border-l-2"
                        style={{ borderColor: color, opacity: 0.55 }}
                      />
                      {group.rows.map((row) => (
                        <PullRequestRow
                          key={row.pullRequest.id}
                          pr={row.pullRequest}
                          snoozed={snoozed}
                          onToggleSnooze={onToggleSnooze}
                          homeSection={section.homeSections?.[row.pullRequest.id]}
                          stackedOn={row.parent}
                          stackColor={color}
                        />
                      ))}
                    </div>
                  );
                })}
                {hiddenCount > 0 && (
                  <p className="px-4 py-2 text-xs text-ink-400 dark:text-ink-500">
                    {hiddenCount} more match this filter. Raise the section limit to see them.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SkeletonRows() {
  return (
    <div className="animate-pulse divide-y divide-ink-100 dark:divide-ink-800">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3">
          <div className="h-6 w-6 rounded-full bg-ink-200 dark:bg-ink-800" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-ink-200 dark:bg-ink-800" />
            <div className="h-2.5 w-1/5 rounded bg-ink-100 dark:bg-ink-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
