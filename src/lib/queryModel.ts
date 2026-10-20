import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const STORAGE_KEY = "crows-foot-query-model";

/** The room billed for writing queries, and the model chosen, kept across launches. */
export interface ModelChoice {
  roomId: string;
  /** The model chosen, or null for the room's default. */
  model: string | null;
}

/** A room and model ready to write a query. */
export type QueryModel = ModelChoice;

function readChoice(): ModelChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ModelChoice> | null;
    return { roomId: typeof stored?.roomId === "string" ? stored.roomId : "", model: stored?.model ?? null };
  } catch {
    return { roomId: "", model: null };
  }
}

/**
 * Whether the Corvic API key is stored, the room and model chosen, and the
 * choice ready to write queries once both a key and a room are set.
 */
export function useQueryModel() {
  const [keyStored, setKeyStored] = useState(false);
  const [choice, setChoice] = useState<ModelChoice>(readChoice);
  const [keyError, setKeyError] = useState<string | null>(null);

  const refreshKey = useCallback(async () => {
    try {
      setKeyStored(await api.llmKeyStored());
      setKeyError(null);
    } catch (caught) {
      setKeyError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void refreshKey();
  }, [refreshKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  }, [choice]);

  const ready: QueryModel | null = keyStored && choice.roomId.trim() !== "" ? choice : null;

  return { keyStored, keyError, refreshKey, choice, setChoice, ready };
}
