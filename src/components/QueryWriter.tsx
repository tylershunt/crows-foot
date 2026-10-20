import { useEffect, useRef, useState } from "react";
import type { GlobalFilter, QueryDraft } from "../../shared/types.js";
import { api, type ChatTurn } from "../lib/api.js";
import type { QueryModel } from "../lib/queryModel.js";
import { QueryPreview } from "./QueryPreview.js";
import { SparklesIcon } from "./icons.js";

interface QueryWriterProps {
  /** The room and model that write, or null until a Corvic API key and a room are set. */
  model: QueryModel | null;
  /** The query the conversation revises, or null to write a new section. */
  currentQuery: string | null;
  globalFilters: GlobalFilter[];
  /** Receives the draft the user accepts. */
  onAccept: (draft: QueryDraft) => void;
  placeholder: string;
  /** Called when the user closes the writer. */
  onCancel?: () => void;
}

type Entry = { fromModel: false; text: string } | { fromModel: true; draft: QueryDraft };

/**
 * A conversation with a model about a section's query. Each answer is a draft,
 * shown with its compiled preview, that the user can accept or ask to change.
 */
export function QueryWriter({ model, currentQuery, globalFilters, onAccept, placeholder, onCancel }: QueryWriterProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<QueryDraft | null>(null);
  // The query the conversation began from, held while accepted drafts change the section's.
  const [startingQuery, setStartingQuery] = useState(currentQuery);
  const logRef = useRef<HTMLDivElement>(null);
  const writesNew = currentQuery === null;
  const latestDraft = [...entries].reverse().find((entry) => entry.fromModel)?.draft ?? null;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, writing]);

  async function send() {
    const text = message.trim();
    if (!model || text === "" || writing) return;
    const asked: Entry[] = [...entries, { fromModel: false, text }];
    setEntries(asked);
    setMessage("");
    setWriting(true);
    setError(null);
    try {
      const turns: ChatTurn[] = asked.map((entry) =>
        entry.fromModel ? { fromModel: true, text: JSON.stringify(entry.draft) } : { fromModel: false, text: entry.text },
      );
      const draft = await api.writeQuery(model.roomId, model.model, turns, startingQuery, globalFilters);
      setEntries([...asked, { fromModel: true, draft }]);
    } catch (caught) {
      setEntries(entries);
      setMessage(text);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWriting(false);
    }
  }

  function startOver() {
    setEntries([]);
    setError(null);
    setAccepted(null);
    setStartingQuery(currentQuery);
  }

  return (
    <div className="mt-2 rounded-lg border border-sheen-500/25 bg-sheen-500/5 p-2.5 dark:bg-sheen-500/10">
      {entries.length > 0 && (
        <div ref={logRef} className="mb-2.5 max-h-96 space-y-2 overflow-y-auto pr-1">
          {entries.map((entry, index) =>
            entry.fromModel ? (
              <DraftMessage
                key={index}
                draft={entry.draft}
                latest={entry.draft === latestDraft}
                writesNew={writesNew}
                accepted={entry.draft === accepted}
                globalFilters={globalFilters}
                onAccept={() => {
                  onAccept(entry.draft);
                  setAccepted(entry.draft);
                }}
              />
            ) : (
              <p
                key={index}
                className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-sheen-600 px-2.5 py-1.5 text-xs text-white"
              >
                {entry.text}
              </p>
            ),
          )}
          {writing && <p className="animate-pulse text-[11px] text-ink-500 dark:text-ink-400">Writing…</p>}
        </div>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <SparklesIcon className="h-3.5 w-3.5 shrink-0 text-sheen-500" />
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && onCancel) {
              event.stopPropagation();
              onCancel();
            }
          }}
          disabled={!model}
          autoFocus
          placeholder={
            !model
              ? "Connect a Corvic API key under Write queries with a model to describe a section"
              : entries.length > 0
                ? "Ask for a change"
                : placeholder
          }
          className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-800 focus:border-sheen-400 focus:outline-none disabled:opacity-60 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
        />
        <button
          type="submit"
          disabled={!model || writing || message.trim() === ""}
          className="shrink-0 rounded-md bg-sheen-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sheen-500 disabled:opacity-40"
        >
          {writing ? "Writing…" : "Send"}
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={startOver}
            disabled={writing}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs text-ink-500 hover:bg-ink-200 disabled:opacity-40 dark:text-ink-400 dark:hover:bg-ink-800"
          >
            Start over
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs text-ink-500 hover:bg-ink-200 dark:text-ink-400 dark:hover:bg-ink-800"
          >
            Close
          </button>
        )}
      </form>

      {error && <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

/** A model's answer: what it found, the query, and, for the latest, its compiled preview. */
function DraftMessage({
  draft,
  latest,
  writesNew,
  accepted,
  globalFilters,
  onAccept,
}: {
  draft: QueryDraft;
  latest: boolean;
  writesNew: boolean;
  accepted: boolean;
  globalFilters: GlobalFilter[];
  onAccept: () => void;
}) {
  return (
    <div
      className={`mr-auto max-w-[95%] rounded-lg rounded-bl-sm border bg-white p-2.5 dark:bg-ink-900 ${
        latest ? "border-ink-200 dark:border-ink-700" : "border-ink-100 opacity-70 dark:border-ink-800"
      }`}
    >
      <p className="text-xs text-ink-700 dark:text-ink-200">{draft.summary}</p>
      {writesNew && <p className="mt-1.5 text-xs font-semibold text-ink-900 dark:text-white">{draft.title}</p>}
      <p className="mt-1 break-words font-mono text-xs text-ink-800 dark:text-ink-200">{draft.query}</p>
      {latest && <QueryPreview query={draft.query} globalFilters={globalFilters} />}
      <div className="mt-2 flex justify-end">
        {accepted ? (
          <span className="px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
            {writesNew ? "Added" : "In use"}
          </span>
        ) : (
          <button
            type="button"
            onClick={onAccept}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              latest
                ? "bg-ink-900 text-white hover:bg-ink-700 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-200"
                : "text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
            }`}
          >
            {writesNew ? "Add section" : "Use this query"}
          </button>
        )}
      </div>
    </div>
  );
}
