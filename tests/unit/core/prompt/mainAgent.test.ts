import { buildSystemPrompt } from '@/core/prompt/mainAgent';

describe('buildSystemPrompt', () => {
  it('instructs agents to decode XML attribute paths exactly once', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('Decode XML entities in an attribute value exactly once');
    expect(prompt).toContain('Do not decode CDATA content');
    expect(prompt).toContain('A &amp; B.md');
  });
});
