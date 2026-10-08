/** One version's section of CHANGELOG.md: a list of changes, in file order. */
export interface ReleaseNotes {
  version: string;
  changes: string[];
}

export type InlineSpan = { kind: "text" | "strong" | "code"; text: string };

const VERSION_HEADING = /^## (\d+\.\d+\.\d+)\s*$/;

/** Every `## x.y.z` section of a changelog, in the order the file lists them. */
export function parseChangelog(text: string): ReleaseNotes[] {
  const notes: ReleaseNotes[] = [];
  let current: ReleaseNotes | null = null;
  for (const line of text.split("\n")) {
    const heading = VERSION_HEADING.exec(line);
    if (heading) {
      current = { version: heading[1]!, changes: [] };
      notes.push(current);
    } else if (line.startsWith("#")) {
      current = null;
    } else if (current) {
      addLine(current.changes, line);
    }
  }
  return notes;
}

/**
 * The notes for the versions after `installed` up to and including `offered`,
 * newest first. Versions without changes are left out.
 */
export function notesBetween(notes: ReleaseNotes[], installed: string, offered: string): ReleaseNotes[] {
  return notes
    .filter((entry) => compareVersions(entry.version, installed) > 0 && compareVersions(entry.version, offered) <= 0)
    .filter((entry) => entry.changes.length > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The changes a release body lists before its `### Installing` section. */
export function notesFromReleaseBody(version: string, body: string): ReleaseNotes {
  const changes: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("#")) break;
    addLine(changes, line);
  }
  return { version, changes };
}

/** Negative, zero, or positive as `a` is older than, equal to, or newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Splits a change into plain text, `**strong**` text, and `` `code` ``. */
export function inlineSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) spans.push({ kind: "text", text: text.slice(last, match.index) });
    spans.push(match[1] !== undefined ? { kind: "strong", text: match[1] } : { kind: "code", text: match[2]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
}

function addLine(changes: string[], line: string) {
  if (line.startsWith("- ")) changes.push(line.slice(2).trim());
  else if (line.trim() && changes.length > 0) changes[changes.length - 1] += ` ${line.trim()}`;
}
