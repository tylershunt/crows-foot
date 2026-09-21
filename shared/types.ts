/**
 * The contract between the interface and the Rust core, mirrored there in
 * `src-tauri/src/types.rs`.
 */

/** Aggregate state of the commit status checks on a pull request's head commit. */
export type CheckState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | "NONE";

/** GitHub's summary of whether a pull request has satisfied its review requirements. */
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "NONE";

export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

export interface Actor {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface Label {
  name: string;
  color: string;
}

export interface Review {
  state: ReviewState;
  author: Actor | null;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  isPrivate: boolean;
  isDraft: boolean;
  /** The branch this pull request merges into. */
  baseRef: string;
  /** The branch holding this pull request's commits. */
  headRef: string;
  /**
   * Whether `baseRef` is a branch other than the repository's default.
   *
   * True for a pull request stacked on another branch, whether that stack was
   * built by Graphite, `gh`, or by hand, and regardless of whether the parent
   * pull request is among the results being displayed.
   */
  targetsNonDefaultBranch: boolean;
  state: PullRequestState;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commentCount: number;
  /** False when the pull request has activity the viewer has not looked at yet. */
  isRead: boolean;
  checkState: CheckState;
  reviewDecision: ReviewDecision;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  author: Actor | null;
  labels: Label[];
  /** Reviewers with an outstanding request, by login for users and by name for teams. */
  requestedReviewers: string[];
  latestReviews: Review[];
}

/** A user-configured group of pull requests, defined by a query. */
export interface SectionConfig {
  id: string;
  title: string;
  /** Crow's Foot query syntax, e.g. `is:open is:pr review:re-requested`. */
  query: string;
  /** Maximum pull requests to fetch and display; GitHub caps a search page at 100. */
  limit: number;
  collapsed: boolean;
  /** Hex accent color for the section header dot. */
  color: string;
  /** Whether this section's matches are added into the badge on the dock icon. */
  countsTowardBadge: boolean;
}

/**
 * A query ANDed into every section's query, narrowing all sections at once.
 *
 * Typically exclusions such as `-author:app/dependabot`, but the whole query
 * language is allowed.
 */
export interface GlobalFilter {
  id: string;
  query: string;
  enabled: boolean;
}

export interface AppConfig {
  sections: SectionConfig[];
  globalFilters: GlobalFilter[];
  refreshIntervalSeconds: number;
}

/** One section's config paired with the pull requests its query returned. */
export interface SectionResult {
  config: SectionConfig;
  pullRequests: PullRequest[];
  /** Matches the section holds, which may exceed `pullRequests.length` when capped by `limit`. */
  totalCount: number;
  /**
   * Whether `totalCount` counts only as far as the first `limit` GitHub
   * returned, which happens when a local qualifier sifts a capped search.
   */
  countIsPartial: boolean;
  error: string | null;
  /**
   * For a section assembled out of the others, the section each pull request
   * would sit in if this one were not holding it, keyed by pull request id.
   */
  homeSections?: Record<string, SectionConfig>;
}

export interface DashboardResponse {
  viewer: Actor;
  sections: SectionResult[];
}

/** What a query comes to: the searches GitHub runs, and advice about them. */
export interface QueryPlan {
  searches: PlannedSearch[];
  warnings: string[];
}

export interface PlannedSearch {
  /** What GitHub is asked, in its own search syntax. */
  query: string;
  /** The qualifiers GitHub cannot answer, asked of the rows it returns. */
  keptLocally: string[];
}
