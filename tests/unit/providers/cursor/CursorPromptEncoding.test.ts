import { buildCursorPrompt } from '@/providers/cursor/execution/CursorExecutionSession';

describe('Cursor prompt encoding', () => {
  it('sends a Cursor slash command without appended context so Cursor runs it natively', () => {
    expect(buildCursorPrompt({
      context: {
        contextFiles: ['notes/design.md'],
        currentNote: { path: 'Projects/Cursor.md' },
      },
      input: [{ text: '/simplify', type: 'text' }],
    } as never)).toEqual([{ text: '/simplify', type: 'text' }]);
  });

  it('keeps note context for ordinary prompts', () => {
    expect(buildCursorPrompt({
      context: { currentNote: { path: 'Projects/Cursor.md' } },
      input: [{ text: 'Explain /simplify', type: 'text' }],
    } as never)[0]).toEqual(expect.objectContaining({
      text: expect.stringContaining('<linked_note path="Projects/Cursor.md" />'),
    }));
  });
});
