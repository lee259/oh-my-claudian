import {
  diffNoteId,
  formatDiffNote,
  formatDiffNotes,
  upsertDiffNote,
} from '@/utils/diffNotes';

describe('diff notes', () => {
  it('keys a note by file and line', () => {
    expect(diffNoteId('src/app.ts', 12)).toBe('src/app.ts:12');
  });

  it('formats the fixed English contract sent to the agent', () => {
    expect(formatDiffNote({
      body: 'Use the shared helper here.',
      filePath: 'src/app.ts',
      id: 'src/app.ts:12',
      line: 12,
    })).toBe([
      'File: src/app.ts',
      'Line: 12',
      'User comment: "Use the shared helper here."',
    ].join('\n'));
  });

  it('keeps a quote and newlines from breaking the block', () => {
    expect(formatDiffNote({
      body: 'say "hi"\nthen stop',
      filePath: 'a.ts',
      id: 'a.ts:3',
      line: 3,
    })).toBe([
      'File: a.ts',
      'Line: 3',
      'User comment: "say \\"hi\\"\\nthen stop"',
    ].join('\n'));
  });

  it('carries the excerpt when the line may have moved', () => {
    expect(formatDiffNote({
      body: 'wrong branch',
      excerpt: '  if (value) {  ',
      filePath: 'b.ts',
      id: 'b.ts:7',
      line: 7,
    })).toContain('Excerpt: if (value) {');
  });

  it('joins several notes with a blank line', () => {
    const notes = [
      { body: 'first', filePath: 'a.ts', id: 'a.ts:1', line: 1 },
      { body: 'second', filePath: 'b.ts', id: 'b.ts:2', line: 2 },
    ];
    expect(formatDiffNotes(notes).split('\n\n')).toHaveLength(2);
  });

  it('replaces an earlier note on the same line instead of stacking', () => {
    const first = { body: 'first', filePath: 'a.ts', id: 'a.ts:1', line: 1 };
    const second = { body: 'second', filePath: 'a.ts', id: 'a.ts:1', line: 1 };
    expect(upsertDiffNote([first], second)).toEqual([second]);
  });

  it('appends a note on a different line', () => {
    const first = { body: 'first', filePath: 'a.ts', id: 'a.ts:1', line: 1 };
    const second = { body: 'second', filePath: 'a.ts', id: 'a.ts:2', line: 2 };
    expect(upsertDiffNote([first], second)).toEqual([first, second]);
  });
});
