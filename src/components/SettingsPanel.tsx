import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AppConfig, GlobalFilter, SectionConfig } from "../../shared/types.js";
import { slugify } from "../lib/format.js";
import { titleBar } from "../lib/titlebar.js";
import { checkForUpdate, type Update } from "../lib/update.js";
import { QueryPreview } from "./QueryPreview.js";
import { InstallUpdate } from "./UpdateBanner.js";
import { ArrowUpIcon, ChevronDownIcon, CrowFootIcon, PlusIcon, TrashIcon } from "./icons.js";

const GLOBAL_FILTER_SUGGESTIONS = [
  "-author:app/dependabot",
  "-author:app/renovate",
  "-is:draft",
  "-label:wip",
  "org:",
  "-repo:",
];

const SWATCHES = ["#f5c451", "#e5484d", "#3dd68c", "#4f8cff", "#a78bfa", "#2dd4bf", "#f2792b", "#9292ad"];

const QUERY_TOKENS = [
  "is:open",
  "is:pr",
  "is:draft",
  "-is:draft",
  "author:@me",
  "review-requested:@me",
  "reviewed-by:@me",
  "assignee:@me",
  "mentions:@me",
  "involves:@me",
  "review:approved",
  "review:changes-requested",
  "review:none",
  "is:merged",
  "archived:false",
  "org:",
  "repo:",
  "label:",
  "sort:updated-desc",
];

/** The half of the language GitHub's search box has no answer for. */
const CROW_TOKENS = [
  "or",
  "not",
  "review:re-requested",
  "checks:failing",
  "idle:>1w",
  "unread:yes",
  "conflicts:yes",
  "stacked:yes",
  "reviewers:0",
  "approvals:>=2",
  "size:>500",
  "files:>20",
];

const PALETTE_STORAGE_KEY = "crows-foot-token-palette";

interface SettingsPanelProps {
  config: AppConfig;
  configPath: string;
  focusSectionId: string | null;
  onSave: (config: AppConfig) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
  update: Update | null;
  onUpdate: (update: Update | null) => void;
}

export function SettingsPanel({
  config,
  configPath,
  focusSectionId,
  onSave,
  onReset,
  onClose,
  update,
  onUpdate,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [paletteOpen, setPaletteOpen] = useState(
    () => localStorage.getItem(PALETTE_STORAGE_KEY) !== "folded",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const activeQueryRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedQueryRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    localStorage.setItem(PALETTE_STORAGE_KEY, paletteOpen ? "open" : "folded");
  }, [paletteOpen]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Arriving from one section's gear means editing that section's query, which
  // sits far below the fold in a panel that opens at the top. Focusing it also
  // makes it the target the token palette appends to.
  useEffect(() => {
    const query = focusedQueryRef.current;
    if (!query) return;
    query.scrollIntoView({ block: "center" });
    query.focus();
  }, [focusSectionId]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);

  async function lookForUpdate() {
    setCheckingUpdate(true);
    setUpdateNote(null);
    try {
      const found = await checkForUpdate();
      onUpdate(found);
      setUpdateNote(found ? null : "This is the latest.");
    } catch (checkError) {
      setUpdateNote(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setCheckingUpdate(false);
    }
  }

  function updateSection(index: number, patch: Partial<SectionConfig>) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, i) => (i === index ? { ...section, ...patch } : section)),
    }));
  }

  function moveSection(index: number, delta: number) {
    setDraft((current) => {
      const sections = [...current.sections];
      const target = index + delta;
      const moved = sections[index];
      const displaced = sections[target];
      if (!moved || !displaced) return current;
      sections[index] = displaced;
      sections[target] = moved;
      return { ...current, sections };
    });
  }

  function removeSection(index: number) {
    setDraft((current) => ({ ...current, sections: current.sections.filter((_, i) => i !== index) }));
  }

  function addSection() {
    setDraft((current) => ({
      ...current,
      sections: [
        ...current.sections,
        {
          id: `section-${Date.now()}`,
          title: "New section",
          query: "is:open is:pr involves:@me archived:false",
          limit: 25,
          collapsed: false,
          color: SWATCHES[current.sections.length % SWATCHES.length] ?? "#9292ad",
          countsTowardBadge: false,
        },
      ],
    }));
  }

  function updateGlobalFilter(index: number, patch: Partial<GlobalFilter>) {
    setDraft((current) => ({
      ...current,
      globalFilters: current.globalFilters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)),
    }));
  }

  function removeGlobalFilter(index: number) {
    setDraft((current) => ({
      ...current,
      globalFilters: current.globalFilters.filter((_, i) => i !== index),
    }));
  }

  function addGlobalFilter(query: string) {
    setDraft((current) => ({
      ...current,
      globalFilters: [...current.globalFilters, { id: `global-${Date.now()}`, query, enabled: true }],
    }));
  }

  function insertToken(token: string) {
    const textarea = activeQueryRef.current;
    if (!textarea) return;
    const index = Number(textarea.dataset.index);
    const existing = draft.sections[index]?.query ?? "";
    updateSection(index, { query: existing ? `${existing.trimEnd()} ${token}` : token });
    textarea.focus();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...draft,
        sections: draft.sections.map((section) => ({ ...section, id: section.id || slugify(section.title) })),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-ink-50 shadow-2xl dark:bg-ink-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feather-sheen h-0.5 w-full" />

        <header
          {...titleBar("flex items-center justify-between border-b border-ink-200 px-5 pb-4 dark:border-ink-800")}
        >
          <div>
            <h2 className="text-base font-semibold text-ink-900 dark:text-white">Sections &amp; filters</h2>
            <p className="mt-0.5 truncate text-xs text-ink-400 dark:text-ink-500">{configPath}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-500 hover:bg-ink-200 dark:text-ink-400 dark:hover:bg-ink-800"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-white">Global filters</h3>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              Added to every section&rsquo;s query. Use exclusions like{" "}
              <code className="font-mono text-[11px]">-author:app/dependabot</code> to hide pull requests
              everywhere at once.
            </p>

            {draft.globalFilters.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {draft.globalFilters.map((filter, index) => (
                  <div key={filter.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filter.enabled}
                      onChange={(event) => updateGlobalFilter(index, { enabled: event.target.checked })}
                      title={filter.enabled ? "Applied to every section" : "Currently ignored"}
                    />
                    <input
                      value={filter.query}
                      onChange={(event) => updateGlobalFilter(index, { query: event.target.value })}
                      spellCheck={false}
                      placeholder="-author:app/dependabot"
                      className={`min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-3 py-1.5 font-mono text-xs focus:border-sheen-400 focus:outline-none dark:border-ink-700 dark:bg-ink-800 ${
                        filter.enabled ? "text-ink-800 dark:text-ink-200" : "text-ink-400 line-through dark:text-ink-500"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeGlobalFilter(index)}
                      title="Delete global filter"
                      className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => addGlobalFilter("")}
              className="mt-3 flex items-center gap-1.5 text-xs text-ink-500 transition hover:text-sheen-600 dark:text-ink-400 dark:hover:text-sheen-400"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add global filter
            </button>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3 dark:border-ink-800">
              {GLOBAL_FILTER_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => addGlobalFilter(suggestion)}
                  className="rounded-md bg-ink-100 px-2 py-1 font-mono text-[11px] text-ink-600 transition hover:bg-sheen-500/15 hover:text-sheen-600 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-sheen-500/20 dark:hover:text-sheen-300"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm dark:border-ink-800 dark:bg-ink-900">
            <span className="font-medium text-ink-700 dark:text-ink-200">Auto-refresh every</span>
            <input
              type="number"
              min={15}
              max={3600}
              value={draft.refreshIntervalSeconds}
              onChange={(event) =>
                setDraft((current) => ({ ...current, refreshIntervalSeconds: Number(event.target.value) }))
              }
              className="w-24 rounded-lg border border-ink-300 bg-white px-2 py-1 tabular-nums dark:border-ink-700 dark:bg-ink-800"
            />
            <span className="text-ink-500 dark:text-ink-400">seconds</span>
          </label>

          <div className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm dark:border-ink-800 dark:bg-ink-900">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-700 dark:text-ink-200">
                This build{version ? ` is ${version}` : ""}
              </p>
              {updateNote && (
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{updateNote}</p>
              )}
            </div>
            {update ? (
              <InstallUpdate update={update} />
            ) : (
              <button
                type="button"
                onClick={() => void lookForUpdate()}
                disabled={checkingUpdate}
                className="shrink-0 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 transition hover:border-sheen-400 hover:text-ink-900 disabled:opacity-60 dark:border-ink-700 dark:text-ink-300 dark:hover:border-sheen-500 dark:hover:text-white"
              >
                {checkingUpdate ? "Checking…" : "Check for updates"}
              </button>
            )}
          </div>

          {draft.sections.map((section, index) => (
            <div
              key={section.id}
              className={`rounded-xl border bg-white p-4 dark:bg-ink-900 ${
                section.id === focusSectionId
                  ? "border-sheen-400 ring-2 ring-sheen-400/20"
                  : "border-ink-200 dark:border-ink-800"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  value={section.title}
                  onChange={(event) => updateSection(index, { title: event.target.value })}
                  placeholder="Section title"
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-ink-900 hover:border-ink-200 focus:border-ink-300 focus:outline-none dark:text-white dark:hover:border-ink-700"
                />
                <button
                  type="button"
                  onClick={() => moveSection(index, -1)}
                  disabled={index === 0}
                  title="Move up"
                  className="rounded p-1.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30 dark:hover:bg-ink-800"
                >
                  <ArrowUpIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(index, 1)}
                  disabled={index === draft.sections.length - 1}
                  title="Move down"
                  className="rounded p-1.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30 dark:hover:bg-ink-800"
                >
                  <ArrowUpIcon className="h-3.5 w-3.5 rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => removeSection(index)}
                  title="Delete section"
                  className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>

              <textarea
                ref={(node) => {
                  if (node && document.activeElement === node) activeQueryRef.current = node;
                  if (section.id === focusSectionId) focusedQueryRef.current = node;
                }}
                data-index={index}
                value={section.query}
                onFocus={(event) => {
                  activeQueryRef.current = event.currentTarget;
                }}
                onChange={(event) => updateSection(index, { query: event.target.value })}
                rows={2}
                spellCheck={false}
                placeholder="is:open is:pr review-requested:@me"
                className="mt-2 w-full resize-y rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs text-ink-800 focus:border-sheen-400 focus:outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
              />

              <QueryPreview query={section.query} globalFilters={draft.globalFilters} />

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
                  Limit
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={section.limit}
                    onChange={(event) => updateSection(index, { limit: Number(event.target.value) })}
                    className="w-16 rounded border border-ink-300 bg-white px-1.5 py-0.5 tabular-nums dark:border-ink-700 dark:bg-ink-800"
                  />
                </label>

                <label className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
                  <input
                    type="checkbox"
                    checked={section.collapsed}
                    onChange={(event) => updateSection(index, { collapsed: event.target.checked })}
                  />
                  Collapsed by default
                </label>

                <label
                  className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400"
                  title="Adds this section's count to the badge on the dock icon"
                >
                  <input
                    type="checkbox"
                    checked={section.countsTowardBadge}
                    onChange={(event) => updateSection(index, { countsTowardBadge: event.target.checked })}
                  />
                  On the dock badge
                </label>

                <div className="ml-auto flex items-center gap-1">
                  {SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => updateSection(index, { color: swatch })}
                      title={swatch}
                      className={`rounded-md p-0.5 transition ${
                        section.color.toLowerCase() === swatch
                          ? "ring-2 ring-ink-400 ring-offset-1 dark:ring-offset-ink-900"
                          : "opacity-60 hover:opacity-100"
                      }`}
                    >
                      <CrowFootIcon className="h-4 w-4" style={{ color: swatch }} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addSection}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 py-3 text-sm text-ink-500 transition hover:border-sheen-400 hover:text-ink-700 dark:border-ink-700 dark:text-ink-400 dark:hover:border-sheen-500 dark:hover:text-ink-200"
          >
            <PlusIcon className="h-4 w-4" />
            Add section
          </button>

          <div className="sticky bottom-0 z-10 rounded-xl border border-ink-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-ink-800 dark:bg-ink-900/95">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setPaletteOpen((open) => !open)}
                aria-expanded={paletteOpen}
                title={paletteOpen ? "Hide the tokens" : "Show the tokens"}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${
                    paletteOpen ? "" : "-rotate-90"
                  }`}
                />
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                  Click to append to the focused query
                </p>
              </button>
              <a
                href="https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests"
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[11px] text-sheen-600 hover:underline dark:text-sheen-400"
              >
                GitHub&rsquo;s reference
              </a>
            </div>

            {paletteOpen && (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUERY_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertToken(token)}
                      className="rounded-md bg-ink-100 px-2 py-1 font-mono text-[11px] text-ink-600 transition hover:bg-sheen-500/15 hover:text-sheen-600 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-sheen-500/20 dark:hover:text-sheen-300"
                    >
                      {token}
                    </button>
                  ))}
                </div>

                <p className="mt-2 border-t border-ink-100 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-400 dark:border-ink-800 dark:text-ink-500">
                  Beyond GitHub&rsquo;s own syntax
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CROW_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertToken(token)}
                      className="rounded-md bg-sheen-500/10 px-2 py-1 font-mono text-[11px] text-sheen-700 transition hover:bg-sheen-500/20 dark:bg-sheen-500/15 dark:text-sheen-300 dark:hover:bg-sheen-500/25"
                    >
                      {token}
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-[11px] text-ink-500 dark:text-ink-400">
                  A space means <em>and</em>, parentheses group, and these last are checked here rather
                  than by GitHub.
                </p>
              </>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-ink-200 px-5 py-4 dark:border-ink-800">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-ink-500 hover:text-rose-600 hover:underline dark:text-ink-400"
          >
            Reset to defaults
          </button>
          {error && <p className="flex-1 truncate text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="ml-auto rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:opacity-40 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-200"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </div>
    </div>
  );
}
