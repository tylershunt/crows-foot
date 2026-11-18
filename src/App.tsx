import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppConfig,
  DashboardResponse,
  PullRequest,
  ReviewerCandidate,
  SectionResult,
} from "../shared/types.js";
import { Section } from "./components/Section.js";
import { SelectionBar } from "./components/SelectionBar.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { UpdateBanner } from "./components/UpdateBanner.js";
import { AlertIcon, FilterIcon, OfflineIcon, RefreshIcon, SearchIcon, SettingsIcon } from "./components/icons.js";
import { retainPullRequests } from "../shared/dashboard.js";
import { enabledGlobalFilters } from "../shared/query.js";
import { SNOOZED_SECTION } from "../shared/snoozed.js";
import { api } from "./lib/api.js";
import { badgeCount, showOnTheDock } from "./lib/badge.js";
import { relativeAge } from "./lib/format.js";
import { keepLastGood } from "./lib/lastGood.js";
import { allReleased, refreshHold, selectionHold } from "./lib/refreshHold.js";
import { selectedPullRequests } from "./lib/selection.js";
import { stackColors } from "./lib/stackColor.js";
import { BESIDE_WINDOW_CONTROLS, titleBar } from "./lib/titlebar.js";
import { checkForUpdate, type Update } from "./lib/update.js";
import {
  offersFound,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  updateCheckDue,
} from "./lib/updateSchedule.js";
import { useScrollbarWhileScrolling } from "./lib/useScrollbarWhileScrolling.js";

type Theme = "light" | "dark";

const OVERGROWTH_STORAGE_KEY = "crows-foot-overgrowth";

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configPath, setConfigPath] = useState("");
  const sectionsScroller = useScrollbarWhileScrolling<HTMLDivElement>();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Why the last refresh failed while an earlier dashboard is still shown. */
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [staleSections, setStaleSections] = useState<Record<string, string>>({});
  const shownDashboard = useRef<DashboardResponse | null>(null);
  shownDashboard.current = dashboard;
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [filterText, setFilterText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overgrowthShown, setOvergrowthShown] = useState(
    () => localStorage.getItem(OVERGROWTH_STORAGE_KEY) !== "off",
  );
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [update, setUpdate] = useState<Update | null>(null);
  const [, setTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const latestRefresh = useRef(0);
  const shownRefresh = useRef(0);

  /**
   * Fetches the dashboard and resolves once the fetch settles. The result is
   * shown once `selectionHold` releases, and for an `automatic` refresh once
   * `refreshHold` releases too.
   */
  const refresh = useCallback(async (automatic = false) => {
    const id = ++latestRefresh.current;
    setRefreshing(true);
    let fetched: DashboardResponse | null = null;
    let failure = "";
    try {
      fetched = await api.dashboard();
    } catch (fetchError) {
      failure = fetchError instanceof Error ? fetchError.message : String(fetchError);
    } finally {
      setRefreshing(false);
    }

    const show = () => {
      if (id < shownRefresh.current) return;
      shownRefresh.current = id;
      if (fetched) {
        const refreshed = keepLastGood(shownDashboard.current, fetched);
        setDashboard(refreshed.dashboard);
        setStaleSections(refreshed.stale);
        setFetchedAt(new Date().toISOString());
        setRefreshError(null);
        setError(null);
      } else if (shownDashboard.current) setRefreshError(failure);
      else setError(failure);
    };
    const holds = automatic ? [refreshHold, selectionHold] : [selectionHold];
    if (holds.every((hold) => hold.remaining() === 0)) show();
    else void allReleased(holds).then(show);
  }, []);

  useEffect(() => {
    const onPointerDown = () => refreshHold.click();
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { config: loaded, path } = await api.config();
        setConfig(loaded);
        setConfigPath(path);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!config) return;
    const interval = setInterval(() => void refresh(true), config.refreshIntervalSeconds * 1000);
    return () => clearInterval(interval);
  }, [config, refresh]);

  useEffect(() => {
    const onFocus = () => void refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const shownUpdate = useRef<Update | null>(null);
  shownUpdate.current = update;
  const dismissedVersion = useRef<string | null>(null);
  const lastUpdateCheck = useRef<number | null>(null);

  useEffect(() => {
    const lookForUpdate = (minimumGapMs: number) => {
      const now = Date.now();
      if (!updateCheckDue(lastUpdateCheck.current, now, minimumGapMs)) return;
      lastUpdateCheck.current = now;
      checkForUpdate().then(
        (found) => {
          if (!found) return;
          if (offersFound(found.version, shownUpdate.current?.version ?? null, dismissedVersion.current)) setUpdate(found);
          else void found.close();
        },
        () => {},
      );
    };
    lookForUpdate(0);
    const interval = setInterval(() => lookForUpdate(UPDATE_CHECK_MIN_GAP_MS), UPDATE_CHECK_INTERVAL_MS);
    const onFocus = () => lookForUpdate(UPDATE_CHECK_MIN_GAP_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const dismissUpdate = useCallback(() => {
    dismissedVersion.current = shownUpdate.current?.version ?? null;
    setUpdate(null);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName);
      if (typing) return;
      if (event.key === "Escape") {
        if (!settingsOpen) setSelectedIds(new Set());
      } else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "r") {
        void refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, settingsOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("crows-foot-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(OVERGROWTH_STORAGE_KEY, overgrowthShown ? "on" : "off");
  }, [overgrowthShown]);

  // The badge counts what GitHub returned, so a filter typed into the box narrows
  // the view without pretending the rest of the pile went away.
  useEffect(() => {
    if (!dashboard) return;
    showOnTheDock(badgeCount(dashboard.sections)).catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : String(caught)),
    );
  }, [dashboard]);

  const sections = useMemo(
    () => (dashboard?.sections ?? []).map((section) => filterSection(section, filterText)),
    [dashboard, filterText],
  );

  const activeGlobalFilters = useMemo(
    () => enabledGlobalFilters(config?.globalFilters ?? []),
    [config],
  );

  // Drawn from every section rather than the filtered view, so a stack keeps its
  // color while the filter box hides the members that name its bottom.
  const stackColor = useMemo(
    () => stackColors((dashboard?.sections ?? []).flatMap((section) => section.pullRequests)),
    [dashboard],
  );

  const applyConfig = useCallback(
    async (next: AppConfig) => {
      const { config: saved, path } = await api.saveConfig(next);
      setConfig(saved);
      setConfigPath(path);
      setCollapsedOverrides({});
      setSettingsOpen(false);
      await refresh();
    },
    [refresh],
  );

  const burnDown = useCallback(async (pullRequests: PullRequest[]) => {
    try {
      await api.openInBrowser(pullRequests.map((pullRequest) => pullRequest.url));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const toggleSnooze = useCallback(
    async (pullRequest: PullRequest, snoozed: boolean) => {
      setDashboard((current) =>
        current
          ? snoozed
            ? retainPullRequests(current, (pr) => pr.id !== pullRequest.id)
            : intoSnoozedSection(current, pullRequest)
          : current,
      );
      try {
        await (snoozed ? api.wake(pullRequest.id) : api.snooze(pullRequest.id));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      // Only a fetch can tell which sections a woken pull request belongs back in.
      if (snoozed) await refresh();
    },
    [refresh],
  );

  const toggleDraft = useCallback(
    async (pullRequest: PullRequest) => {
      const draft = !pullRequest.isDraft;
      setDashboard((current) => current && withPullRequest(current, pullRequest.id, (pr) => ({ ...pr, isDraft: draft })));
      try {
        const isDraft = await api.setDraft(pullRequest.id, draft);
        setDashboard((current) => current && withPullRequest(current, pullRequest.id, (pr) => ({ ...pr, isDraft })));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      // Sections that ask for `is:draft` or `-is:draft` take or give up the pull request.
      await refresh();
    },
    [refresh],
  );

  const requestReviewers = useCallback(
    async (pullRequest: PullRequest, reviewers: ReviewerCandidate[]) => {
      await api.requestReviewers(pullRequest.id, reviewers);
      const logins = reviewers.map((reviewer) => reviewer.login);
      setDashboard(
        (current) =>
          current &&
          withPullRequest(current, pullRequest.id, (pr) => ({
            ...pr,
            requestedReviewers: [...new Set([...pr.requestedReviewers, ...logins])],
          })),
      );
      void refresh();
    },
    [refresh],
  );

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selecting = selectedIds.size > 0;
  useEffect(() => (selecting ? selectionHold.hold() : undefined), [selecting]);
  const selected = useMemo(
    () => selectedPullRequests(dashboard?.sections ?? [], selectedIds),
    [dashboard, selectedIds],
  );

  const toggleSelected = useCallback((pullRequest: PullRequest) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(pullRequest.id)) next.add(pullRequest.id);
      return next;
    });
  }, []);

  const setDrafts = useCallback(
    async (pullRequests: PullRequest[], draft: boolean) => {
      const setIsDraft = (isDraft: (pullRequest: PullRequest, index: number) => boolean) =>
        setDashboard(
          (current) =>
            current &&
            pullRequests.reduce(
              (next, pullRequest, index) =>
                withPullRequest(next, pullRequest.id, (pr) => ({ ...pr, isDraft: isDraft(pullRequest, index) })),
              current,
            ),
        );
      setIsDraft(() => draft);
      const outcomes = await Promise.allSettled(pullRequests.map((pullRequest) => api.setDraft(pullRequest.id, draft)));
      setIsDraft((pullRequest, index) => {
        const outcome = outcomes[index]!;
        return outcome.status === "fulfilled" ? outcome.value : pullRequest.isDraft;
      });
      const failed = pullRequests.filter((_, index) => outcomes[index]!.status === "rejected");
      if (failed.length > 0) {
        setError(`Could not change ${failed.map((pullRequest) => `#${pullRequest.number}`).join(", ")}: ${failure(outcomes)}`);
      }
      void refresh();
    },
    [refresh],
  );

  const requestReviewersOnAll = useCallback(
    async (pullRequests: PullRequest[], reviewers: ReviewerCandidate[]) => {
      const outcomes = await Promise.allSettled(
        pullRequests.map((pullRequest) => api.requestReviewers(pullRequest.id, reviewers)),
      );
      const logins = reviewers.map((reviewer) => reviewer.login);
      const requested = pullRequests.filter((_, index) => outcomes[index]!.status === "fulfilled");
      setDashboard(
        (current) =>
          current &&
          requested.reduce(
            (next, pullRequest) =>
              withPullRequest(next, pullRequest.id, (pr) => ({
                ...pr,
                requestedReviewers: [...new Set([...pr.requestedReviewers, ...logins])],
              })),
            current,
          ),
      );
      void refresh();
      const failed = pullRequests.filter((_, index) => outcomes[index]!.status === "rejected");
      if (failed.length > 0) {
        throw new Error(`Could not request on ${failed.map((pullRequest) => `#${pullRequest.number}`).join(", ")}: ${failure(outcomes)}`);
      }
    },
    [refresh],
  );

  const resetConfig = useCallback(async () => {
    const { config: saved, path } = await api.resetConfig();
    setConfig(saved);
    setConfigPath(path);
    setCollapsedOverrides({});
    setSettingsOpen(false);
    await refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <main className="flex min-h-0 flex-1 flex-col">
        <header
          {...titleBar(
            `sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-ink-200 bg-ink-100/90 pr-4 ${BESIDE_WINDOW_CONTROLS} backdrop-blur dark:border-ink-800 dark:bg-ink-950/90`,
          )}
        >
          <div className="flex shrink-0 items-center gap-2.5">
            {/* Great Vibes inks about 3px above the middle of its line box. */}
            <p className="wordmark-sheen mx-3 translate-y-[3px] bg-clip-text font-script text-2xl leading-tight text-transparent">
              Crow&rsquo;s Foot
            </p>
            {dashboard?.viewer && (
              <a
                href={dashboard.viewer.url}
                target="_blank"
                rel="noreferrer"
                title={dashboard.viewer.login}
                className="shrink-0 rounded-full transition hover:ring-2 hover:ring-sheen-400"
              >
                <img
                  src={dashboard.viewer.avatarUrl}
                  alt={dashboard.viewer.login}
                  className="h-7 w-7 rounded-full ring-1 ring-sheen-400/40"
                />
              </a>
            )}
          </div>

          {selecting ? (
            <SelectionBar
              selected={selected}
              viewerLogin={dashboard?.viewer.login ?? null}
              onSetDraft={setDrafts}
              onRequestReviewers={requestReviewersOnAll}
              onClear={() => setSelectedIds(new Set())}
            />
          ) : (
            <>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                ref={searchRef}
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="Filter loaded pull requests…  (/)"
                className="w-full rounded-lg border border-ink-200 bg-white py-1.5 pl-9 pr-3 text-xs placeholder:text-ink-400 focus:border-sheen-400 focus:outline-none dark:border-ink-800 dark:bg-ink-900"
              />
            </div>

            {activeGlobalFilters.length > 0 && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title={`Narrowing every section:\n${activeGlobalFilters.map((f) => f.query).join("\n")}`}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-sheen-500/10 px-2.5 py-1 text-xs text-sheen-600 transition hover:bg-sheen-500/20 dark:text-sheen-300"
              >
                <FilterIcon className="h-3 w-3" />
                {activeGlobalFilters.length} global filter{activeGlobalFilters.length === 1 ? "" : "s"}
              </button>
            )}
            </>
          )}

          {refreshError && (
            <span
              title={`${refreshError}\nShowing what was fetched ${fetchedAt ? `${relativeAge(fetchedAt)} ago` : "earlier"}.`}
              className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
            >
              <OfflineIcon className="h-3.5 w-3.5" />
              {fetchedAt ? `Offline · ${relativeAge(fetchedAt)}` : "Offline"}
            </span>
          )}

          {!selecting && (
            <button
              type="button"
              onClick={() => void refresh()}
              title="Refresh (r)"
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-600 transition hover:border-sheen-400 hover:text-ink-900 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-sheen-500 dark:hover:text-white"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="ml-auto shrink-0 rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-200 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={sectionsScroller}
          className="scrollbar-while-scrolling flex-1 overflow-y-auto overscroll-y-contain px-6 py-5"
        >
          {update && <UpdateBanner update={update} onDismiss={dismissUpdate} />}

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            {sections.map((section) => {
              const collapsed = collapsedOverrides[section.config.id] ?? startsCollapsed(section);
              const shown = new Set(section.pullRequests.map((pullRequest) => pullRequest.id));
              const otherPullRequests = (dashboard?.sections ?? [])
                .flatMap((other) => other.pullRequests)
                .filter((pullRequest) => !shown.has(pullRequest.id));

              return (
                <Section
                  key={section.config.id}
                  section={section}
                  loading={refreshing}
                  staleError={staleSections[section.config.id] ?? null}
                  collapsed={collapsed}
                  onToggle={() =>
                    setCollapsedOverrides((current) => ({ ...current, [section.config.id]: !collapsed }))
                  }
                  onBurnDown={burnDown}
                  onToggleSnooze={toggleSnooze}
                  onToggleDraft={toggleDraft}
                  onRequestReviewers={requestReviewers}
                  viewerLogin={dashboard?.viewer.login ?? null}
                  overgrowthShown={overgrowthShown}
                  stackColor={stackColor}
                  otherPullRequests={otherPullRequests}
                  selectedIds={selectedIds}
                  onToggleSelected={toggleSelected}
                />
              );
            })}

            {config && config.sections.length === 0 && (
              <p className="py-16 text-center text-sm text-ink-400">
                No sections configured yet. Open Settings to add one.
              </p>
            )}
          </div>
        </div>
      </main>

      {settingsOpen && config && (
        <SettingsPanel
          config={config}
          configPath={configPath}
          theme={theme}
          onTheme={setTheme}
          overgrowthShown={overgrowthShown}
          onOvergrowthShown={setOvergrowthShown}
          onSave={applyConfig}
          onReset={resetConfig}
          update={update}
          onUpdate={setUpdate}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Mirrors, until the next fetch, where the backend will place a newly snoozed
 * pull request: held in the snoozed section, remembering the first section that
 * was showing it.
 */
function intoSnoozedSection(dashboard: DashboardResponse, pullRequest: PullRequest): DashboardResponse {
  const home = dashboard.sections.find((section) =>
    section.pullRequests.some((pr) => pr.id === pullRequest.id),
  )?.config;
  const elsewhere = retainPullRequests(dashboard, (pr) => pr.id !== pullRequest.id);

  return {
    ...elsewhere,
    sections: elsewhere.sections.map((section) =>
      section.config.id === SNOOZED_SECTION.id
        ? {
            ...section,
            pullRequests: [pullRequest, ...section.pullRequests],
            totalCount: section.totalCount + 1,
            homeSections: { ...section.homeSections, ...(home ? { [pullRequest.id]: home } : {}) },
          }
        : section,
    ),
  };
}

/** The first rejection's message among `outcomes`. */
function failure(outcomes: PromiseSettledResult<unknown>[]): string {
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  const reason: unknown = rejected?.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

/** Applies `update` to every copy of one pull request on the dashboard. */
function withPullRequest(
  dashboard: DashboardResponse,
  pullRequestId: string,
  update: (pullRequest: PullRequest) => PullRequest,
): DashboardResponse {
  return {
    ...dashboard,
    sections: dashboard.sections.map((section) => ({
      ...section,
      pullRequests: section.pullRequests.map((pr) => (pr.id === pullRequestId ? update(pr) : pr)),
    })),
  };
}

/**
 * Whether a section is collapsed until the user toggles it themselves.
 *
 * Sections configured collapsed start that way, as do sections with no matches,
 * so empty cards don't push the sections that need attention off the screen. A
 * failed query stays expanded because its error is the thing worth reading.
 */
function startsCollapsed(section: SectionResult): boolean {
  return section.config.collapsed || (section.error === null && section.totalCount === 0);
}

/** Narrows a section's already-fetched pull requests to those matching free text. */
function filterSection(section: SectionResult, filterText: string): SectionResult {
  const needle = filterText.trim().toLowerCase();
  if (!needle) return section;

  const pullRequests = section.pullRequests.filter((pr) => matches(pr, needle));
  return { ...section, pullRequests, totalCount: pullRequests.length };
}

function matches(pr: PullRequest, needle: string): boolean {
  return [pr.title, pr.repo, `#${pr.number}`, pr.author?.login ?? "", ...pr.labels.map((label) => label.name)]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
