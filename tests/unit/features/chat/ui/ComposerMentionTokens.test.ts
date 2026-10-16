import { findComposerFileMentions } from '@/features/chat/ui/ComposerMentionTokens';

describe('composer file reference labels', () => {
  const files = new Map([
    ['one/plan.md', { path: 'one/plan.md', name: 'plan.md' }],
    ['two/plan.md', { path: 'two/plan.md', name: 'plan.md' }],
    ['notes/a plan.md', { path: 'notes/a plan.md', name: 'a plan.md' }],
    ['assets/diagram.png', { path: 'assets/diagram.png', name: 'diagram.png' }],
  ]);
  const resolve = (path: string) => files.get(path) ?? null;

  it('uses short labels while preserving distinct full paths and exact source ranges', () => {
    const text = 'Compare @one/plan.md and @two/plan.md ';
    const tokens = findComposerFileMentions(text, resolve);
    expect(tokens.map(token => [token.label, token.path])).toEqual([
      ['plan', 'one/plan.md'], ['plan', 'two/plan.md'],
    ]);
    for (const token of tokens) expect(text.slice(token.index, token.index + token.fullMatch.length)).toBe(token.fullMatch);
  });

  it('resolves spaces and separates trailing punctuation from the reference', () => {
    expect(findComposerFileMentions('Review @notes/a plan.md, please.', resolve)).toEqual([
      expect.objectContaining({ label: 'a plan', path: 'notes/a plan.md', fullMatch: '@notes/a plan.md' }),
    ]);
  });

  it('keeps non-Markdown extensions and leaves unresolved paths and folders as text', () => {
    expect(findComposerFileMentions('@missing.md @notes/ @assets/diagram.png ', resolve).map(t => t.label)).toEqual(['diagram.png']);
  });

  it('does not interpret code samples, escaped mentions, or email addresses as references', () => {
    expect(findComposerFileMentions('`@one/plan.md` \\@one/plan.md user@one/plan.md\n```\n@two/plan.md\n```', resolve)).toEqual([]);
  });
});
