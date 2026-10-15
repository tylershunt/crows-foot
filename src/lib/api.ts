import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  DashboardResponse,
  GlobalFilter,
  LlmKeyState,
  LlmModel,
  LlmProvider,
  ParentReviewers,
  QueryDraft,
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

/** One message of a conversation with a model; a model's message is the JSON of its draft. */
export interface ChatTurn {
  fromModel: boolean;
  text: string;
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
  llmKeys: () => call<LlmKeyState[]>("llm_keys"),
  /** Checks the key with the provider, stores it in the Keychain, and resolves to the models it opens. */
  setLlmKey: (provider: LlmProvider, key: string) => call<LlmModel[]>("set_llm_key", { provider, key }),
  forgetLlmKey: (provider: LlmProvider) => call<void>("forget_llm_key", { provider }),
  /** The models the provider's stored key opens, the recommended one first. */
  llmModels: (provider: LlmProvider) => call<LlmModel[]>("llm_models", { provider }),
  /**
   * The section the conversation in `messages` calls for, revising
   * `currentQuery` when it is set, whose query compiles alongside
   * `globalFilters`. `messages` ends with the user's latest message.
   */
  writeQuery: (
    provider: LlmProvider,
    model: string,
    messages: ChatTurn[],
    currentQuery: string | null,
    globalFilters: GlobalFilter[],
  ) => call<QueryDraft>("write_query", { provider, model, request: { messages, currentQuery }, globalFilters }),
  /** Opens each URL as a browser tab, in the order given. */
  openInBrowser: (urls: string[]) => call<void>("open_in_browser", { urls }),
};
