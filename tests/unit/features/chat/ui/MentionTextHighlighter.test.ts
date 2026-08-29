/** @jest-environment jsdom */

import { MentionTextHighlighter } from '@/features/chat/ui/MentionTextHighlighter';

describe('MentionTextHighlighter', () => {
  function createFixture() {
    const wrapper = document.createElement('div');
    const highlights = document.createElement('div');
    const input = document.createElement('textarea');
    wrapper.append(highlights, input);
    document.body.appendChild(wrapper);
    return { highlights, input, wrapper };
  }

  it('emphasizes file and folder mentions while preserving the full input text', () => {
    const { highlights, input, wrapper } = createFixture();
    input.value = 'Review @notes/plan.md and @src/ before sending.';
    const highlighter = new MentionTextHighlighter(input, highlights);

    expect(highlights.textContent).toBe(input.value);
    expect([...highlights.querySelectorAll('.claudian-input-mention-highlight')]
      .map(element => element.textContent)).toEqual(['@notes/plan.md', '@src/']);

    highlighter.destroy();
    wrapper.remove();
  });

  it('refreshes after a mention is selected from the dropdown', () => {
    const { highlights, input, wrapper } = createFixture();
    const highlighter = new MentionTextHighlighter(input, highlights);

    input.value = '@notes/plan.md ';
    input.dispatchEvent(new Event('claudian:mention-inserted'));

    expect(highlights.querySelector('.claudian-input-mention-highlight')?.textContent)
      .toBe('@notes/plan.md');

    highlighter.destroy();
    wrapper.remove();
  });

  it('makes existing file mentions interactive', () => {
    const { highlights, input, wrapper } = createFixture();
    const app = {
      metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue({ path: 'notes/plan.md' }) },
      workspace: { openLinkText: jest.fn() },
    } as any;
    input.value = '@notes/plan.md';
    const highlighter = new MentionTextHighlighter(input, highlights, app);

    const mention = highlights.querySelector('.claudian-input-mention-highlight') as HTMLElement;
    expect(mention.classList.contains('internal-link')).toBe(true);
    mention.click();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('notes/plan.md', '', 'tab');

    highlighter.destroy();
    wrapper.remove();
  });

  it('keeps its mirrored text aligned with textarea scrolling', () => {
    const { highlights, input, wrapper } = createFixture();
    const highlighter = new MentionTextHighlighter(input, highlights);
    input.scrollLeft = 12;
    input.scrollTop = 24;
    input.dispatchEvent(new Event('scroll'));

    expect((highlights.firstElementChild as HTMLElement).style.transform)
      .toBe('translate(-12px, -24px)');

    highlighter.destroy();
    wrapper.remove();
  });
});
