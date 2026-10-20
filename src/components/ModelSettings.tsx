import { useEffect, useState } from "react";
import type { LlmModel } from "../../shared/types.js";
import { api } from "../lib/api.js";
import type { ModelChoice } from "../lib/queryModel.js";
import { SparklesIcon } from "./icons.js";

interface ModelSettingsProps {
  keyStored: boolean;
  keyError: string | null;
  refreshKey: () => Promise<void>;
  choice: ModelChoice;
  onChoice: (update: (current: ModelChoice) => ModelChoice) => void;
}

const FIELD =
  "min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-3 py-1.5 font-mono text-xs text-ink-800 focus:border-sheen-400 focus:outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200";
const BUTTON =
  "shrink-0 rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-600 transition hover:border-sheen-400 hover:text-ink-900 disabled:opacity-50 dark:border-ink-700 dark:text-ink-300 dark:hover:border-sheen-500 dark:hover:text-white";

/** The Corvic API key, room, and model that write section queries. */
export function ModelSettings({ keyStored, keyError, refreshKey, choice, onChoice }: ModelSettingsProps) {
  const [models, setModels] = useState<LlmModel[] | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [roomInput, setRoomInput] = useState(choice.roomId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomId = choice.roomId.trim();

  useEffect(() => {
    setModels(null);
    if (!keyStored || roomId === "") return;
    let listening = true;
    api.llmModels(roomId).then(
      (offered) => {
        if (!listening) return;
        setModels(offered);
        setError(null);
      },
      (caught: unknown) => listening && setError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      listening = false;
    };
  }, [keyStored, roomId]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const offered = await api.setLlmKey(keyInput, roomInput.trim());
      setKeyInput("");
      onChoice(() => ({ roomId: roomInput.trim(), model: null }));
      setModels(offered);
      await refreshKey();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api.forgetLlmKey();
      await refreshKey();
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
        Describe a section and a model writes its query, through Corvic&rsquo;s LLM router. Completions are billed to
        the room. The API key is kept in the macOS Keychain.
      </p>

      {keyStored ? (
        <div className="mt-3 space-y-2 text-xs">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onChoice(() => ({ roomId: roomInput.trim(), model: null }));
            }}
          >
            <span className="w-12 shrink-0 text-ink-500 dark:text-ink-400">Room</span>
            <input
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              placeholder="Room id"
              spellCheck={false}
              className={FIELD}
            />
            <button type="submit" disabled={roomInput.trim() === roomId} className={BUTTON}>
              Use room
            </button>
          </form>
          <label className="flex items-center gap-2 text-ink-500 dark:text-ink-400">
            <span className="w-12 shrink-0">Model</span>
            <select
              value={choice.model ?? ""}
              disabled={!models}
              onChange={(event) => onChoice((current) => ({ ...current, model: event.target.value || null }))}
              className={`${FIELD} font-sans`}
            >
              <option value="">{models ? "The room's default" : roomId ? "Loading models…" : "Set a room first"}</option>
              {models?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                  {model.organization ? " (your organization's)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-ink-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-ink-400 dark:hover:bg-rose-500/10"
            >
              Remove key
            </button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder="Corvic API key"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} w-full`}
          />
          <div className="flex items-center gap-2">
            <input
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              placeholder="Room id the completions are billed to"
              spellCheck={false}
              className={FIELD}
            />
            <button
              type="submit"
              disabled={busy || keyInput.trim() === "" || roomInput.trim() === ""}
              className={BUTTON}
            >
              {busy ? "Checking…" : "Connect"}
            </button>
          </div>
        </form>
      )}

      {shownError && <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{shownError}</p>}
    </div>
  );
}
