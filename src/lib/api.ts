import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  DashboardResponse,
  GlobalFilter,
  ParentReviewers,
  QueryPlan,
  ReviewerCandidate,
} from "../../shared/types.js";

export interface ConfigResponse {
  config: AppConfig;
  path: string;
}

/** Raised when the app's backend reports a failure; `message` is safe to show to the user. */
export class ApiError extends Error {}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (rejection) {
    throw new ApiError(typeof rejection === "string" ? rejection : String(rejection));
  }
}

export const api = {
  dashboard: () => call<DashboardResponse>("get_dashboard"),
  config: () => call<ConfigResponse>("get_config"),
  saveConfig: (config: AppConfig) => call<ConfigResponse>("save_config", { config }),
  resetConfig: () => call<ConfigResponse>("reset_config"),
  explainQuery: (query: string, globalFilters: GlobalFilter[]) =>
    call<QueryPlan>("explain_query", { query, globalFilters }),
  /** Resolves to whether GitHub now holds the pull request as a draft. */
  setDraft: (pullRequestId: string, draft: boolean) => call<boolean>("set_draft", { pullRequestId, draft }),
  /** People, then teams, who could review the pull request, narrowed to `query` when it is not empty. */
  reviewerCandidates: (pullRequestId: string, query: string) =>
    call<ReviewerCandidate[]>("reviewer_candidates", { pullRequestId, query }),
  /** The reviewers of the open pull request this one is stacked on, or null when there is none. */
  parentReviewers: (pullRequestId: string) => call<ParentReviewers | null>("parent_reviewers", { pullRequestId }),
  /** Asks each reviewer, person or team, to review the pull request, keeping the requests already open. */
  requestReviewers: (pullRequestId: string, reviewers: ReviewerCandidate[]) =>
    call<void>("request_reviewers", {
      pullRequestId,
      userIds: reviewers.filter((reviewer) => reviewer.kind === "user").map((reviewer) => reviewer.id),
      teamIds: reviewers.filter((reviewer) => reviewer.kind === "team").map((reviewer) => reviewer.id),
    }),
  snooze: (pullRequestId: string) => call<void>("snooze", { pullRequestId }),
  wake: (pullRequestId: string) => call<void>("wake", { pullRequestId }),
};
