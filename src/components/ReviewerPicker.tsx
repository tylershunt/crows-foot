import { useEffect, useState } from "react";
import type { ParentReviewers, PullRequest, ReviewerCandidate } from "../../shared/types.js";
import { api } from "../lib/api.js";
import { CheckIcon, SearchIcon, StackIcon } from "./icons.js";
import { Popover } from "./Popover.js";

interface ReviewerPickerProps {
  pr: PullRequest;
  /** The control the picker opens above or below. */
  anchor: HTMLElement;
  /** The element whose right edge the picker's right edge meets; the anchor by default. */
  edge?: HTMLElement | null;
  /** Rejects with a message to show in the picker, which then stays open. */
  onRequest: (candidates: ReviewerCandidate[]) => Promise<void>;
  onClose: () => void;
}

const SEARCH_DELAY_MS = 200;
const PANEL_WIDTH = 288;
const PANEL_HEIGHT = 340;

/**
 * A panel for asking people to review `pr`: GitHub's suggestions until a search
 * is typed, then the repository's collaborators matching it. A pull request
 * stacked on an open one is offered that one's reviewers, listed first.
 */
export function ReviewerPicker({ pr, anchor, edge, onRequest, onClose }: ReviewerPickerProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReviewerCandidate[] | null>(null);
  const [chosen, setChosen] = useState<ReviewerCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [parent, setParent] = useState<ParentReviewers | null>(null);

  useEffect(() => {
    if (!pr.targetsNonDefaultBranch) return;
    let current = true;
    api.parentReviewers(pr.id).then(
      (found) => current && setParent(found),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [pr.id, pr.targetsNonDefaultBranch]);

  useEffect(() => {
    let current = true;
    const timeout = setTimeout(
      () => {
        api.reviewerCandidates(pr.id, query.trim()).then(
          (found) => current && (setCandidates(found), setError(null)),
          (caught: unknown) => current && setError(caught instanceof Error ? caught.message : String(caught)),
        );
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [pr.id, query]);

  const requested = new Set(pr.requestedReviewers);
  const copyable = (parent?.reviewers ?? []).filter(
    (reviewer) => !requested.has(reviewer.login) && !chosen.some((one) => one.id === reviewer.id),
  );
  const listed =
    candidates && !query.trim() && parent
      ? [...parent.reviewers, ...candidates].filter(
          (candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index,
        )
      : candidates;

  const toggle = (candidate: ReviewerCandidate) =>
    setChosen((current) =>
      current.some((one) => one.id === candidate.id)
        ? current.filter((one) => one.id !== candidate.id)
        : [...current, candidate],
    );

  const submit = async () => {
    if (chosen.length === 0 || requesting) return;
    setRequesting(true);
    try {
      await onRequest(chosen);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setRequesting(false);
    }
  };

  return (
    <Popover
      anchor={anchor}
      edge={edge}
      onClose={onClose}
      label={`Request reviewers for ${pr.title}`}
      width={PANEL_WIDTH}
      maxHeight={PANEL_HEIGHT}
    >
      <div className="relative border-b border-ink-200 p-2 dark:border-ink-800">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void submit()}
          placeholder="Search collaborators…"
          className="w-full rounded-lg border border-ink-200 bg-ink-50 py-1.5 pl-7 pr-2 placeholder:text-ink-400 focus:border-sheen-400 focus:outline-none dark:border-ink-800 dark:bg-ink-950"
        />
      </div>

      {parent && parent.reviewers.length > 0 && (
        <button
          type="button"
          disabled={copyable.length === 0}
          onClick={() => setChosen((current) => [...current, ...copyable])}
          title={parent.reviewers.map((reviewer) => reviewer.login).join(", ")}
          className="flex items-center gap-2 border-b border-ink-200 px-3 py-2 text-left font-medium text-sheen-600 hover:bg-sheen-500/10 disabled:cursor-default disabled:text-ink-400 disabled:hover:bg-transparent dark:border-ink-800 dark:text-sheen-300 dark:disabled:text-ink-500"
        >
          <StackIcon className="h-3.5 w-3.5 shrink-0" />
          {copyable.length === 0
            ? `Every reviewer of #${parent.number} is picked`
            : `Copy ${copyable.length === 1 ? "1 reviewer" : `${copyable.length} reviewers`} from #${parent.number}`}
        </button>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {listed === null && !error && <li className="px-3 py-2 text-ink-400">Finding reviewers…</li>}
        {listed?.length === 0 && (
          <li className="px-3 py-2 text-ink-400">{query ? "No collaborator matches." : "No suggestions."}</li>
        )}
        {listed?.map((candidate) => {
          const already = requested.has(candidate.login);
          const picked = already || chosen.some((one) => one.id === candidate.id);
          return (
            <li key={candidate.id}>
              <button
                type="button"
                disabled={already}
                onClick={() => toggle(candidate)}
                title={already ? `${candidate.login} is already requested` : undefined}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sheen-500/10 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                    picked ? "border-sheen-500 bg-sheen-500 text-white" : "border-ink-300 dark:border-ink-600"
                  }`}
                >
                  {picked && <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <img src={candidate.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                <span className="min-w-0 truncate">
                  <span className="font-medium text-ink-800 dark:text-ink-100">{candidate.login}</span>
                  {candidate.name && <span className="ml-1.5 text-ink-400">{candidate.name}</span>}
                </span>
                {already && <span className="ml-auto shrink-0 text-[10px] text-ink-400">requested</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="border-t border-rose-200 px-3 py-2 text-rose-600 dark:border-rose-500/30 dark:text-rose-300">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-ink-200 p-2 dark:border-ink-800">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1.5 text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={chosen.length === 0 || requesting}
          onClick={() => void submit()}
          className="rounded-lg bg-sheen-500 px-2.5 py-1.5 font-medium text-white hover:bg-sheen-600 disabled:opacity-40"
        >
          {requesting ? "Requesting…" : chosen.length > 1 ? `Request ${chosen.length} reviews` : "Request review"}
        </button>
      </div>
    </Popover>
  );
}
