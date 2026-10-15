import { useEffect, useState } from "react";
import type { LlmModel, LlmProvider } from "../../shared/types.js";
import { api } from "../lib/api.js";
import { type ModelChoice, PROVIDER_NAMES } from "../lib/queryModel.js";
import { SparklesIcon } from "./icons.js";

interface ModelSettingsProps {
  keys: Partial<Record<LlmProvider, boolean>>;
  keyError: string | null;
  refreshKeys: () => Promise<void>;
  choice: ModelChoice;
  onChoice: (update: (current: ModelChoice) => ModelChoice) => void;
}

const PROVIDERS: LlmProvider[] = ["anthropic", "openai"];

const KEY_PLACEHOLDERS: Record<LlmProvider, string> = { anthropic: "sk-ant-…", openai: "sk-…" };

/** The API keys and the model that write section queries from a description. */
export function ModelSettings({ keys, keyError, refreshKeys, choice, onChoice }: ModelSettingsProps) {
  const provider = choice.provider;
  const stored = keys[provider] === true;
  const [models, setModels] = useState<LlmModel[] | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = (offered: LlmModel[]) => {
    setModels(offered);
    onChoice((current) => {
      const chosen = current.models[provider];
      if (chosen && offered.some((model) => model.id === chosen)) return current;
      const recommended = offered.find((model) => model.recommended) ?? offered[0];
      return recommended ? { ...current, models: { ...current.models, [provider]: recommended.id } } : current;
    });
  };

  useEffect(() => {
    setModels(null);
    setError(null);
    setKeyInput("");
    if (!stored) return;
    let listening = true;
    api.llmModels(provider).then(
      (offered) => listening && adopt(offered),
      (caught: unknown) => listening && setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      listening = false;
    };
  }, [provider, stored]);

  async function saveKey() {
    setBusy(true);
    setError(null);
    try {
      const offered = await api.setLlmKey(provider, keyInput);
      setKeyInput("");
      await refreshKeys();
      adopt(offered);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function forgetKey() {
    setBusy(true);
    setError(null);
    try {
      await api.forgetLlmKey(provider);
      await refreshKeys();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const shownError = error ?? keyError;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900 dark:text-white">
        <SparklesIcon className="h-3.5 w-3.5 text-sheen-500" />
        Write queries with a model
      </h3>
      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
        Describe a section and a model writes its query. Uses your own API key, kept in the macOS Keychain.
      </p>

      <div className="mt-3 flex items-center gap-1 rounded-lg bg-ink-100 p-0.5 text-xs dark:bg-ink-800" role="radiogroup">
        {PROVIDERS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={provider === option}
            onClick={() => onChoice((current) => ({ ...current, provider: option }))}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 transition ${
              provider === option
                ? "bg-white font-medium text-ink-900 shadow-sm dark:bg-ink-700 dark:text-white"
                : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200"
            }`}
          >
            {PROVIDER_NAMES[option]}
            {keys[option] && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Key saved" />}
          </button>
        ))}
      </div>

      {stored ? (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-ink-500 dark:text-ink-400">
            Model
            <select
              value={choice.models[provider] ?? ""}
              disabled={!models}
              onChange={(event) =>
                onChoice((current) => ({ ...current, models: { ...current.models, [provider]: event.target.value } }))
              }
              className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-2 py-1.5 text-ink-800 focus:border-sheen-400 focus:outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
            >
              {!models && <option value={choice.models[provider] ?? ""}>Loading models…</option>}
              {models?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {model.recommended ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void forgetKey()}
            disabled={busy}
            className="shrink-0 rounded-lg px-2 py-1.5 text-ink-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-ink-400 dark:hover:bg-rose-500/10"
          >
            Remove key
          </button>
        </div>
      ) : (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder={`${PROVIDER_NAMES[provider]} API key, ${KEY_PLACEHOLDERS[provider]}`}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-3 py-1.5 font-mono text-xs text-ink-800 focus:border-sheen-400 focus:outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
          />
          <button
            type="submit"
            disabled={busy || keyInput.trim() === ""}
            className="shrink-0 rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-600 transition hover:border-sheen-400 hover:text-ink-900 disabled:opacity-50 dark:border-ink-700 dark:text-ink-300 dark:hover:border-sheen-500 dark:hover:text-white"
          >
            {busy ? "Checking…" : "Save key"}
          </button>
        </form>
      )}

      {shownError && <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{shownError}</p>}
    </div>
  );
}
