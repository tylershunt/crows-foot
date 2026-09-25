import type { ReactNode } from "react";
import type { CheckState, PullRequest, ReviewDecision, ReviewState, SectionConfig } from "../../shared/types.js";
import { absoluteTime, readableTextColor, relativeAge } from "../lib/format.js";
import { useOverflowTitle } from "../lib/useOverflowTitle.js";
import { SectionMarker } from "./SectionMarker.js";
import {
  CheckCircleIcon,
  ClockIcon,
  CommentIcon,
  DashCircleIcon,
  DraftIcon,
  LockIcon,
  MergeIcon,
  PullRequestIcon,
  StackIcon,
  XCircleIcon,
} from "./icons.js";

interface PullRequestRowProps {
  pr: PullRequest;
  /** Whether this row is listed as snoozed, where its control wakes instead. */
  snoozed: boolean;
  onToggleSnooze: (pullRequest: PullRequest, snoozed: boolean) => void;
  /** The section this row would sit in, shown in place of the unread marker when set. */
  homeSection?: SectionConfig;
  /** The pull request this one is stacked on, when that one is on the dashboard. */
  stackedOn?: PullRequest | null;
  /** Marks a pull request stacked on a branch whose pull request is not shown here. */
  detached?: boolean;
  /** The color of the stack this row belongs to, worn by its stack marker. */
  stackColor: string;
}

export function PullRequestRow({
  pr,
  snoozed,
  onToggleSnooze,
  homeSection,
  stackedOn = null,
  detached = false,
  stackColor,
}: PullRequestRowProps) {
  const { ref: titleRef, title: titleTooltip } = useOverflowTitle<HTMLSpanElement>(pr.title);

  return (
    <div className="group relative flex items-center border-b border-ink-100 transition-colors hover:bg-sheen-500/5 dark:border-ink-800/70 dark:hover:bg-sheen-500/10">
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4"
      >
        {homeSection ? (
          <span title={`Waiting in ${homeSection.title}`} className="flex shrink-0">
            <SectionMarker config={homeSection} glow className="h-3 w-3" />
          </span>
        ) : (
          <span
            title={pr.isRead ? undefined : "Unread activity"}
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              pr.isRead ? "" : "bg-ink-950 ring-1 ring-sheen-400 shadow-[0_0_6px_2px_#8b6cf677]"
            }`}
          />
        )}

        <StateIcon pr={pr} />

        {pr.author && (
          <img
            src={pr.author.avatarUrl}
            alt={pr.author.login}
            title={pr.author.login}
            className="h-5 w-5 shrink-0 rounded-full ring-1 ring-ink-200 dark:ring-ink-700"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              ref={titleRef}
              title={titleTooltip}
              className={`truncate text-xs leading-4 ${
                pr.isRead ? "font-medium text-ink-700 dark:text-ink-200" : "font-semibold text-ink-900 dark:text-white"
              }`}
            >
              {pr.title}
            </span>
            {pr.isDraft && <Chip className="bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400">Draft</Chip>}
            {pr.mergeable === "CONFLICTING" && (
              <Chip className="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                Conflicts
              </Chip>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] leading-3 text-ink-500 dark:text-ink-400">
            {(stackedOn || detached) && (
              <span
                title={
                  stackedOn
                    ? `Stacked on #${stackedOn.number} — ${stackedOn.title}`
                    : `Stacked on ${pr.baseRef}`
                }
                className="flex shrink-0 items-center gap-1"
              >
                <StackIcon className="h-3 w-3" style={{ color: stackColor }} />
                {stackedOn && <span className="tabular-nums">on #{stackedOn.number}</span>}
              </span>
            )}
            {pr.isPrivate && <LockIcon className="h-3 w-3 shrink-0" />}
            <span className="truncate">{pr.repo}</span>
            <span className="text-ink-300 dark:text-ink-600">#{pr.number}</span>
            {pr.author && (
              <>
                <Separator />
                <span className="truncate">{pr.author.login}</span>
              </>
            )}
            <Separator />
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+{pr.additions}</span>
            <span className="tabular-nums text-rose-600 dark:text-rose-400">-{pr.deletions}</span>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1 lg:flex">
          {pr.labels.slice(0, 3).map((label) => (
            <span
              key={label.name}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `#${label.color}`, color: readableTextColor(`#${label.color}`) }}
            >
              {label.name}
            </span>
          ))}
        </div>

        {pr.commentCount > 0 && (
          <span className="hidden shrink-0 items-center gap-1 text-[10px] text-ink-400 sm:flex dark:text-ink-500">
            <CommentIcon className="h-3 w-3" />
            <span className="tabular-nums">{pr.commentCount}</span>
          </span>
        )}

        <ReviewerStack pr={pr} />

        <ReviewDecisionChip decision={pr.reviewDecision} />

        <CheckStateIcon state={pr.checkState} />

        <time
          dateTime={pr.updatedAt}
          title={`Updated ${absoluteTime(pr.updatedAt)}`}
          className="w-9 shrink-0 text-right text-[10px] tabular-nums text-ink-400 dark:text-ink-500"
        >
          {relativeAge(pr.updatedAt)}
        </time>
      </a>

      <button
        type="button"
        onClick={() => onToggleSnooze(pr, snoozed)}
        title={snoozed ? "Wake now" : "Snooze until this pull request is updated"}
        aria-label={`${snoozed ? "Wake" : "Snooze"} ${pr.title}`}
        className={`m-1.5 shrink-0 cursor-pointer rounded-md px-2 py-1.5 text-sm leading-none transition hover:bg-sheen-500/15 hover:grayscale-0 focus:opacity-100 group-hover:opacity-100 ${
          snoozed ? "opacity-100" : "opacity-0 grayscale"
        }`}
      >
        {snoozed ? <>&#9200;</> : <>&#128564;</>}
      </button>
    </div>
  );
}

function Separator() {
  return <span className="text-ink-300 dark:text-ink-600">·</span>;
}

function Chip({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

function StateIcon({ pr }: { pr: PullRequest }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (pr.state === "MERGED") return <MergeIcon className={`${className} text-sheen-400`} />;
  if (pr.state === "CLOSED") return <XCircleIcon className={`${className} text-rose-500`} />;
  if (pr.isDraft) return <DraftIcon className={`${className} text-ink-400`} />;
  return <PullRequestIcon className={`${className} text-emerald-500`} />;
}

const CHECK_PRESENTATION: Record<CheckState, { Icon: typeof CheckCircleIcon; className: string; label: string }> = {
  SUCCESS: { Icon: CheckCircleIcon, className: "text-emerald-500", label: "Checks passing" },
  FAILURE: { Icon: XCircleIcon, className: "text-rose-500", label: "Checks failing" },
  ERROR: { Icon: XCircleIcon, className: "text-rose-500", label: "Checks errored" },
  PENDING: { Icon: ClockIcon, className: "text-glint-500", label: "Checks running" },
  EXPECTED: { Icon: ClockIcon, className: "text-glint-500", label: "Checks expected" },
  NONE: { Icon: DashCircleIcon, className: "text-ink-300 dark:text-ink-700", label: "No checks" },
};

function CheckStateIcon({ state }: { state: CheckState }) {
  const { Icon, className, label } = CHECK_PRESENTATION[state];
  return (
    <Icon className={`h-3.5 w-3.5 shrink-0 ${className}`} role="img" aria-label={label}>
      <title>{label}</title>
    </Icon>
  );
}

const REVIEW_PRESENTATION: Record<ReviewDecision, { label: string; className: string } | null> = {
  APPROVED: {
    label: "Approved",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  CHANGES_REQUESTED: {
    label: "Changes",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  },
  REVIEW_REQUIRED: {
    label: "Review",
    className: "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400",
  },
  NONE: null,
};

function ReviewDecisionChip({ decision }: { decision: ReviewDecision }) {
  const presentation = REVIEW_PRESENTATION[decision];
  if (!presentation) return <span className="hidden w-[68px] shrink-0 md:block" />;
  return (
    <span className="hidden w-[68px] shrink-0 md:block">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${presentation.className}`}>
        {presentation.label}
      </span>
    </span>
  );
}

const REVIEW_RING: Record<ReviewState, string> = {
  APPROVED: "ring-emerald-400 dark:ring-emerald-500",
  CHANGES_REQUESTED: "ring-rose-400 dark:ring-rose-500",
  COMMENTED: "ring-ink-300 dark:ring-ink-500",
  DISMISSED: "ring-ink-300 dark:ring-ink-600",
  PENDING: "ring-glint-400 dark:ring-glint-500",
};

const REVIEW_VERDICT: Record<ReviewState, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "has a pending review",
};

function ReviewerStack({ pr }: { pr: PullRequest }) {
  const reviewed = pr.latestReviews.filter((review) => review.author);
  const pending = pr.requestedReviewers;
  if (reviewed.length === 0 && pending.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center -space-x-1.5" aria-label={reviewerTooltip(pr)}>
      {reviewed.map((review) => (
        <img
          key={`review-${review.author!.login}`}
          src={review.author!.avatarUrl}
          alt={review.author!.login}
          title={`${review.author!.login} ${REVIEW_VERDICT[review.state]}`}
          className={`h-5 w-5 rounded-full ring-2 ${REVIEW_RING[review.state]}`}
        />
      ))}
      {pending.map((login) => (
        <span
          key={`request-${login}`}
          title={`${login} owes a review`}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-200 text-[8px] font-semibold uppercase text-ink-600 ring-2 ring-ink-100 dark:bg-ink-700 dark:text-ink-300 dark:ring-ink-900"
        >
          {login.slice(0, 2)}
        </span>
      ))}
    </div>
  );
}

function reviewerTooltip(pr: PullRequest): string {
  const parts = (Object.keys(REVIEW_VERDICT) as ReviewState[]).flatMap((state) => {
    const names = pr.latestReviews
      .filter((review) => review.state === state && review.author)
      .map((review) => review.author!.login);
    return names.length ? [`${REVIEW_VERDICT[state]}: ${names.join(", ")}`] : [];
  });
  if (pr.requestedReviewers.length) parts.push(`awaiting: ${pr.requestedReviewers.join(", ")}`);
  return parts.join(" · ");
}
