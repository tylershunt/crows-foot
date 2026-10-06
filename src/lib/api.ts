import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, DashboardResponse, GlobalFilter, QueryPlan } from "../../shared/types.js";

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
  snooze: (pullRequestId: string) => call<void>("snooze", { pullRequestId }),
  wake: (pullRequestId: string) => call<void>("wake", { pullRequestId }),
};
