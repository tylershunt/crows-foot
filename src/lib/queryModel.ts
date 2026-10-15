import { useCallback, useEffect, useState } from "react";
import type { LlmProvider } from "../../shared/types.js";
import { api } from "./api.js";

const STORAGE_KEY = "crows-foot-query-model";

export const PROVIDER_NAMES: Record<LlmProvider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/** The provider and model chosen to write queries, kept across launches. */
export interface ModelChoice {
  provider: LlmProvider;
  /** The model chosen for each provider, absent until the user picks one. */
  models: Partial<Record<LlmProvider, string>>;
}

/** A provider and model ready to write a query. */
export interface QueryModel {
  provider: LlmProvider;
  model: string;
}

function readChoice(): ModelChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as ModelChoice | null;
    if (stored && (stored.provider === "anthropic" || stored.provider === "openai")) {
      return { provider: stored.provider, models: stored.models ?? {} };
    }
  } catch {
    // An unreadable choice is no choice.
  }
  return { provider: "anthropic", models: {} };
}

/**
 * Which providers hold a key, which provider and model are chosen, and the
 * model ready to write queries when the chosen provider has a key and a model.
 */
export function useQueryModel() {
  const [keys, setKeys] = useState<Partial<Record<LlmProvider, boolean>>>({});
  const [choice, setChoice] = useState<ModelChoice>(readChoice);
  const [keyError, setKeyError] = useState<string | null>(null);

  const refreshKeys = useCallback(async () => {
    try {
      const states = await api.llmKeys();
      setKeys(Object.fromEntries(states.map((state) => [state.provider, state.stored])));
      setKeyError(null);
    } catch (caught) {
      setKeyError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  }, [choice]);

  const model = choice.models[choice.provider];
  const ready: QueryModel | null = keys[choice.provider] && model ? { provider: choice.provider, model } : null;

  return { keys, keyError, refreshKeys, choice, setChoice, ready };
}
