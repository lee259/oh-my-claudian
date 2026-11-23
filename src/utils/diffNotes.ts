/** One review note a user left on a rendered diff line, waiting to be sent with the next message. */
export interface DiffNote {
  /** Deterministic file+line key: adding again on the same line replaces the body. */
  id: string;
  filePath: string;
  line: number;
  body: string;
  /** The line as rendered, so a stale line number still locates the note. */
  excerpt?: string;
}

export function diffNoteId(filePath: string, line: number): string {
  return `${filePath}:${line}`;
}

/** Quote- and newline-safe so the block survives being pasted into any agent's prompt. */
function escapeCommentBody(body: string): string {
  return body
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/** The fixed English contract sent to the agent; card labels stay localized. */
export function formatDiffNote(note: DiffNote): string {
  const lines = [`File: ${note.filePath}`, `Line: ${note.line}`];
  if (note.excerpt?.trim()) lines.push(`Excerpt: ${note.excerpt.trim()}`);
  lines.push(`User comment: "${escapeCommentBody(note.body)}"`);
  return lines.join('\n');
}

export function formatDiffNotes(notes: readonly DiffNote[]): string {
  return notes.map(formatDiffNote).join('\n\n');
}

/** Adds a note, replacing any earlier note on the same file and line. */
export function upsertDiffNote(notes: readonly DiffNote[], note: DiffNote): DiffNote[] {
  const index = notes.findIndex(existing => existing.id === note.id);
  if (index < 0) return [...notes, note];
  const next = [...notes];
  next[index] = note;
  return next;
}
