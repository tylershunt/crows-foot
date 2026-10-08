import { useEffect, useState } from "react";
import { inlineSpans, type ReleaseNotes } from "../lib/changelog.js";
import type { Update } from "../lib/update.js";
import { installAndRelaunch, releaseNotes } from "../lib/update.js";
import { XCircleIcon } from "./icons.js";

interface InstallUpdateProps {
  update: Update;
}

/** Installs `update` and relaunches into it. */
export function InstallUpdate({ update }: InstallUpdateProps) {
  const [phase, setPhase] = useState<"idle" | "downloading" | "installing">("idle");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setError(null);
    setPhase("downloading");
    try {
      await installAndRelaunch(update, (event) => {
        switch (event.event) {
          case "Started":
            setReceived(0);
            setTotal(event.data.contentLength);
            break;
          case "Progress":
            setReceived((soFar) => soFar + event.data.chunkLength);
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase("idle");
    }
  }

  const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;
  const label =
    phase === "downloading"
      ? percent === null
        ? "Downloading…"
        : `Downloading ${percent}%`
      : phase === "installing"
        ? "Installing…"
        : `Install ${update.version} and restart`;

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void install()}
        disabled={phase !== "idle"}
        className="rounded-lg bg-sheen-600 px-3 py-1.5 text-sm text-white transition hover:bg-sheen-500 disabled:cursor-wait disabled:opacity-80"
      >
        {label}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

interface UpdateBannerProps {
  update: Update;
  onDismiss: () => void;
}

export function UpdateBanner({ update, onDismiss }: UpdateBannerProps) {
  return (
    <div className="mb-4 rounded-xl border border-sheen-400/40 bg-sheen-500/10 px-4 py-3 text-sm text-sheen-600 dark:border-sheen-500/30 dark:text-sheen-300">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1">Crow&rsquo;s Foot {update.version} is ready.</p>
        <InstallUpdate update={update} />
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          className="shrink-0 text-sheen-400 hover:text-sheen-600 dark:hover:text-sheen-300"
        >
          <XCircleIcon className="h-4 w-4" />
        </button>
      </div>
      <WhatsNew update={update} />
    </div>
  );
}

/** The changes `update` brings, under a heading for each version it spans. */
export function WhatsNew({ update }: { update: Update }) {
  const [notes, setNotes] = useState<ReleaseNotes[]>([]);

  useEffect(() => {
    let current = true;
    setNotes([]);
    void releaseNotes(update).then((found) => {
      if (current) setNotes(found);
    });
    return () => {
      current = false;
    };
  }, [update]);

  if (notes.length === 0) return null;
  const headed = notes.length > 1;

  return (
    <div className="mt-2 max-h-56 space-y-2 overflow-y-auto text-xs text-ink-700 dark:text-ink-200">
      {notes.map((entry) => (
        <section key={entry.version}>
          {headed && <h3 className="mb-0.5 font-semibold text-ink-500 dark:text-ink-400">{entry.version}</h3>}
          <ul className="list-disc space-y-0.5 pl-4">
            {entry.changes.map((change) => (
              <li key={change}>
                <Change text={change} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Change({ text }: { text: string }) {
  return (
    <>
      {inlineSpans(text).map((span, index) =>
        span.kind === "strong" ? (
          <strong key={index} className="font-semibold">
            {span.text}
          </strong>
        ) : span.kind === "code" ? (
          <code key={index} className="rounded bg-ink-100 px-1 font-mono text-[11px] dark:bg-ink-800">
            {span.text}
          </code>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}
