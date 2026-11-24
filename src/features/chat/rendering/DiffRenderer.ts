import { setIcon } from 'obsidian';

import type { DiffLine, DiffStats } from '../../../core/types/diff';
import { t } from '../../../i18n/i18n';
import { type DiffNote, diffNoteId } from '../../../utils/diffNotes';

/** Where a rendered diff sends the review note a user writes on one of its lines. */
export interface DiffNoteTarget {
  readonly filePath: string;
  readonly onAddNote: (note: DiffNote) => void;
}

const NOTE_TEXTAREA_MIN_HEIGHT = 60;
const NOTE_TEXTAREA_MAX_HEIGHT = 240;

export interface DiffHunk {
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
}

export function renderDiffStats(statsEl: HTMLElement, stats: DiffStats): void {
  if (stats.added > 0) {
    const addedEl = statsEl.createSpan({ cls: 'added' });
    addedEl.setText(`+${stats.added}`);
  }
  if (stats.removed > 0) {
    if (stats.added > 0) {
      statsEl.createSpan({ text: ' ' });
    }
    const removedEl = statsEl.createSpan({ cls: 'removed' });
    removedEl.setText(`-${stats.removed}`);
  }
}

export function splitIntoHunks(diffLines: DiffLine[], contextLines = 3): DiffHunk[] {
  if (diffLines.length === 0) return [];

  // Find indices of all changed lines
  const changedIndices: number[] = [];
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== 'equal') {
      changedIndices.push(i);
    }
  }

  // If no changes, return empty
  if (changedIndices.length === 0) return [];

  // Group changed lines into ranges with context
  const ranges: Array<{ start: number; end: number }> = [];

  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(diffLines.length - 1, idx + contextLines);

    // Merge with previous range if overlapping or adjacent
    if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
      ranges[ranges.length - 1].end = end;
    } else {
      ranges.push({ start, end });
    }
  }

  // Convert ranges to hunks
  const hunks: DiffHunk[] = [];

  for (const range of ranges) {
    const lines = diffLines.slice(range.start, range.end + 1);

    // Find the starting line numbers for this hunk
    let oldStart = 1;
    let newStart = 1;

    // Count lines before this range
    for (let i = 0; i < range.start; i++) {
      const line = diffLines[i];
      if (line.type === 'equal' || line.type === 'delete') oldStart++;
      if (line.type === 'equal' || line.type === 'insert') newStart++;
    }

    hunks.push({ lines, oldStart, newStart });
  }

  return hunks;
}

/** Max lines to render for all-inserts diffs (new file creation). */
const NEW_FILE_DISPLAY_CAP = 20;

/** A line's note affordance opens one inline draft under it; a non-empty draft is kept when another line is clicked. */
interface DiffNoteDraftHandle {
  /** Grows the open draft's anchor to include another line. */
  extendTo: (lineNumber: number) => void;
}

interface DiffNoteDraftRef {
  current: DiffNoteDraftHandle | null;
}

/** Keeps the draft's range visible so a Shift+click extension is obvious. */
function highlightNoteRange(containerEl: HTMLElement, startLine: number, endLine: number): void {
  containerEl.querySelectorAll<HTMLElement>('[data-diff-line]').forEach(lineEl => {
    const lineNumber = Number(lineEl.dataset.diffLine);
    lineEl.classList.toggle(
      'claudian-diff-note-range',
      lineNumber >= startLine && lineNumber <= endLine,
    );
  });
}

function clearNoteRange(containerEl: HTMLElement): void {
  containerEl.querySelectorAll<HTMLElement>('.claudian-diff-note-range').forEach(lineEl => {
    lineEl.classList.remove('claudian-diff-note-range');
  });
}

function openNoteDraft(
  containerEl: HTMLElement,
  parent: HTMLElement,
  lineEl: HTMLElement,
  line: DiffLine,
  lineNumber: number,
  target: DiffNoteTarget,
  draftRef: DiffNoteDraftRef,
): void {
  const existing = containerEl.querySelector<HTMLElement>('.claudian-diff-note-draft');
  if (existing) {
    const existingInput = existing.querySelector('textarea');
    if (existingInput && existingInput.value.trim().length > 0) {
      existingInput.focus();
      return;
    }
    existing.remove();
    draftRef.current = null;
    clearNoteRange(containerEl);
  }

  let startLine = lineNumber;
  let endLine = lineNumber;
  const draft = parent.createDiv({ cls: 'claudian-diff-note-draft' });
  lineEl.after(draft);
  const handle: DiffNoteDraftHandle = {
    extendTo: (next: number): void => {
      startLine = Math.min(startLine, next);
      endLine = Math.max(endLine, next);
      highlightNoteRange(containerEl, startLine, endLine);
    },
  };
  draftRef.current = handle;
  highlightNoteRange(containerEl, startLine, endLine);

  const textarea = draft.createEl('textarea', {
    cls: 'claudian-diff-note-input',
    attr: {
      'aria-label': t('chat.diffNotes.add'),
      placeholder: t('chat.diffNotes.placeholder'),
      rows: '2',
    },
  });
  const actions = draft.createDiv({ cls: 'claudian-diff-note-actions' });
  const cancelButton = actions.createEl('button', {
    cls: 'claudian-diff-note-cancel',
    text: t('common.cancel'),
    attr: { type: 'button' },
  });
  const saveButton = actions.createEl('button', {
    cls: 'claudian-diff-note-save',
    text: t('common.save'),
    attr: { type: 'button' },
  });

  const cleanup = (): void => {
    draft.remove();
    if (draftRef.current === handle) draftRef.current = null;
    clearNoteRange(containerEl);
  };
  const submit = (): void => {
    const body = textarea.value.trim();
    if (!body) return;
    target.onAddNote({
      body,
      ...(line.text.trim() ? { excerpt: line.text.trim() } : {}),
      filePath: target.filePath,
      id: diffNoteId(target.filePath, endLine, startLine),
      line: endLine,
      ...(startLine !== endLine ? { startLine } : {}),
    });
    cleanup();
  };
  const resize = (): void => {
    textarea.setCssProps({ height: 'auto' });
    textarea.setCssProps({
      height: `${Math.min(
        Math.max(textarea.scrollHeight, NOTE_TEXTAREA_MIN_HEIGHT),
        NOTE_TEXTAREA_MAX_HEIGHT,
      )}px`,
    });
  };
  // A disabled save is the only feedback an empty draft needs; Enter still routes through submit's guard.
  const syncSaveState = (): void => {
    saveButton.disabled = textarea.value.trim().length === 0;
  };

  textarea.addEventListener('input', () => {
    resize();
    syncSaveState();
  });
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      return;
    }
    if (event.key !== 'Enter' || event.isComposing) return;
    // Plain Enter sends, Shift+Enter adds a line, and Cmd/Ctrl+Enter sends even with Shift.
    if (event.metaKey || event.ctrlKey || !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  });
  cancelButton.addEventListener('click', event => {
    event.preventDefault();
    cleanup();
  });
  saveButton.addEventListener('click', event => {
    event.preventDefault();
    submit();
  });

  resize();
  syncSaveState();
  textarea.focus();
}

function addNoteAffordance(
  containerEl: HTMLElement,
  parent: HTMLElement,
  lineEl: HTMLElement,
  line: DiffLine,
  lineNumber: number,
  target: DiffNoteTarget,
  draftRef: DiffNoteDraftRef,
): void {
  lineEl.addClass('claudian-diff-line--commentable');
  lineEl.dataset.diffLine = String(lineNumber);
  const addButton = lineEl.createEl('button', {
    cls: 'claudian-diff-note-add',
    attr: {
      type: 'button',
      'aria-label': t('chat.diffNotes.add'),
      'data-tooltip-position': 'top',
    },
  });
  setIcon(addButton, 'plus');
  addButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && draftRef.current) {
      draftRef.current.extendTo(lineNumber);
      return;
    }
    openNoteDraft(containerEl, parent, lineEl, line, lineNumber, target, draftRef);
  });
}

export function renderDiffContent(
  containerEl: HTMLElement,
  diffLines: DiffLine[],
  contextLines = 3,
  noteTarget?: DiffNoteTarget,
): void {
  containerEl.empty();
  const draftRef: DiffNoteDraftRef = { current: null };

  const appendLine = (parent: HTMLElement, line: DiffLine): void => {
    const lineEl = parent.createDiv({ cls: `claudian-diff-line claudian-diff-${line.type}` });
    const prefixEl = lineEl.createSpan({ cls: 'claudian-diff-prefix' });
    prefixEl.setText(line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ');
    const contentEl = lineEl.createSpan({ cls: 'claudian-diff-text' });
    contentEl.setText(line.text || ' ');
    if (noteTarget && line.type !== 'delete' && typeof line.newLineNum === 'number') {
      addNoteAffordance(containerEl, parent, lineEl, line, line.newLineNum, noteTarget, draftRef);
    }
  };

  // New file creation: all lines are inserts — cap display to avoid large DOM
  const allInserts = diffLines.length > 0 && diffLines.every(l => l.type === 'insert');
  if (allInserts && diffLines.length > NEW_FILE_DISPLAY_CAP) {
    const hunkEl = containerEl.createDiv({ cls: 'claudian-diff-hunk' });
    for (const line of diffLines.slice(0, NEW_FILE_DISPLAY_CAP)) {
      appendLine(hunkEl, line);
    }
    const remaining = diffLines.length - NEW_FILE_DISPLAY_CAP;
    const separator = containerEl.createDiv({ cls: 'claudian-diff-separator' });
    separator.setText(`... ${remaining} more lines`);
    return;
  }

  const hunks = splitIntoHunks(diffLines, contextLines);

  if (hunks.length === 0) {
    // No changes
    const noChanges = containerEl.createDiv({ cls: 'claudian-diff-no-changes' });
    noChanges.setText(t('chat.rendering.noChanges'));
    return;
  }

  hunks.forEach((hunk, hunkIndex) => {
    // Add separator between hunks
    if (hunkIndex > 0) {
      const separator = containerEl.createDiv({ cls: 'claudian-diff-separator' });
      separator.setText('...');
    }

    // Render hunk lines
    const hunkEl = containerEl.createDiv({ cls: 'claudian-diff-hunk' });

    for (const line of hunk.lines) {
      appendLine(hunkEl, line);
    }
  });
}
