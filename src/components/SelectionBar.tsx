import { type ReactNode, type SVGProps, useEffect, useState } from "react";
import type { PullRequest, ReviewerCandidate } from "../../shared/types.js";
import { COPY_CONFIRMATION_MS, copyText } from "../lib/external.js";
import { allAuthoredBy } from "../lib/selection.js";
import { markdownLinkList } from "../lib/stackLinks.js";
import { CheckIcon, DraftIcon, LinkIcon, MarkdownIcon, PullRequestIcon, UserPlusIcon, XIcon } from "./icons.js";
import { ReviewerPicker } from "./ReviewerPicker.js";

interface SelectionBarProps {
  /** The selected pull requests, in dashboard order; at least one. */
  selected: PullRequest[];
  /** The signed-in GitHub user, whose own pull requests take the draft and reviewer actions. */
  viewerLogin: string | null;
  onSetDraft: (pullRequests: PullRequest[], draft: boolean) => Promise<void>;
  /** Rejects with a message the reviewer picker shows. */
  onRequestReviewers: (pullRequests: PullRequest[], reviewers: ReviewerCandidate[]) => Promise<void>;
  onClear: () => void;
}

const BUTTON =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-sheen-400 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-40 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-sheen-500 dark:hover:text-white";

/** The top bar's actions on the selected pull requests, shown in place of search and refresh. */
export function SelectionBar({ selected, viewerLogin, onSetDraft, onRequestReviewers, onClear }: SelectionBarProps) {
  const mine = allAuthoredBy(selected, viewerLogin);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [drafting, setDrafting] = useState(false);

  const setDraft = async (draft: boolean) => {
    setDrafting(true);
    try {
      await onSetDraft(
        selected.filter((pullRequest) => pullRequest.isDraft !== draft),
        draft,
      );
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={onClear}
        title="Clear the selection (Esc)"
        aria-label="Clear the selection"
        className="shrink-0 rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-200 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
      >
        <XIcon className="h-4 w-4" />
      </button>
      <span className="shrink-0 text-xs font-medium tabular-nums text-ink-700 dark:text-ink-200">
        {selected.length} selected
      </span>

      <div className="ml-2 flex min-w-0 items-center gap-2 overflow-x-auto">
        <CopyButton
          text={() => selected.map((pullRequest) => pullRequest.url).join("\n")}
          title="Copies the URL of each selected pull request, one per line"
          icon={LinkIcon}
          label="Copy links"
        />
        <CopyButton
          text={() => markdownLinkList(selected)}
          title="Copies a Markdown list linking each selected pull request"
          icon={MarkdownIcon}
          label="Copy Markdown links"
        />

        {mine && (
          <>
            <button
              type="button"
              onClick={(event) => setPickerAnchor(pickerAnchor ? null : event.currentTarget)}
              className={BUTTON}
            >
              <UserPlusIcon className="h-3.5 w-3.5" />
              Request reviewers
            </button>
            <button
              type="button"
              disabled={drafting || selected.every((pullRequest) => pullRequest.isDraft)}
              onClick={() => void setDraft(true)}
              className={BUTTON}
            >
              <DraftIcon className="h-3.5 w-3.5" />
              Convert to draft
            </button>
            <button
              type="button"
              disabled={drafting || selected.every((pullRequest) => !pullRequest.isDraft)}
              onClick={() => void setDraft(false)}
              className={BUTTON}
            >
              <PullRequestIcon className="h-3.5 w-3.5" />
              Mark ready for review
            </button>
          </>
        )}
      </div>

      {pickerAnchor && (
        <ReviewerPicker
          pullRequests={selected}
          anchor={pickerAnchor}
          onRequest={(reviewers) => onRequestReviewers(selected, reviewers)}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </div>
  );
}

function CopyButton({
  text,
  title,
  icon: Icon,
  label,
}: {
  text: () => string;
  title: string;
  icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
  label: string;
}) {
  const [outcome, setOutcome] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!outcome) return;
    const timeout = setTimeout(() => setOutcome(null), COPY_CONFIRMATION_MS);
    return () => clearTimeout(timeout);
  }, [outcome]);

  return (
    <button
      type="button"
      title={title}
      onClick={() =>
        copyText(text()).then(
          () => setOutcome("copied"),
          () => setOutcome("failed"),
        )
      }
      className={BUTTON}
    >
      {outcome === "copied" ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Icon className={`h-3.5 w-3.5 ${outcome === "failed" ? "text-rose-500" : ""}`} />
      )}
      {outcome === "copied" ? "Copied" : outcome === "failed" ? "Copy failed" : label}
    </button>
  );
}
