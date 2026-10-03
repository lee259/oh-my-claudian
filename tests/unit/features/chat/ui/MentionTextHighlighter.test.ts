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
    expect(highlights.classList.contains('claudian-input-mention-highlights')).toBe(true);
    expect(mention.classList.contains('claudian-input-mention-highlight--clickable')).toBe(true);
    expect(mention.classList.contains('internal-link')).toBe(true);
    mention.click();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('notes/plan.md', '', 'tab');

    highlighter.destroy();
    wrapper.remove();
  });

  it('classifies resolved files, resolved folders, and missing targets for distinct styling', () => {
    const { highlights, input, wrapper } = createFixture();
    const app = {
      metadataCache: {
        getFirstLinkpathDest: jest.fn((path: string) => path === 'notes/plan.md' ? { path } : null),
      },
      vault: { getAbstractFileByPath: jest.fn((path: string) => path === 'src' ? { path } : null) },
      workspace: { getLeavesOfType: jest.fn().mockReturnValue([]), openLinkText: jest.fn() },
    } as any;
    input.value = '@notes/plan.md @src/ @missing.md';
    const highlighter = new MentionTextHighlighter(input, highlights, app);

    const [file, folder, missing] = [...highlights.querySelectorAll<HTMLElement>('.claudian-input-mention-highlight')];
    expect(file.dataset.mentionKind).toBe('file');
    expect(file.dataset.mentionState).toBe('resolved');
    expect(folder.dataset.mentionKind).toBe('folder');
    expect(folder.dataset.mentionState).toBe('resolved');
    expect(missing.dataset.mentionKind).toBe('file');
    expect(missing.dataset.mentionState).toBe('missing');
    expect(highlights.textContent).toBe(input.value);

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

  it('mirrors values assigned programmatically without an input event', () => {
    const { highlights, input, wrapper } = createFixture();
    const highlighter = new MentionTextHighlighter(input, highlights);
    input.value = '/eff';
    input.dispatchEvent(new Event('input'));

    // Slash command selection, new conversations, and mode resets assign value directly.
    input.value = '/effort ';
    expect(highlights.textContent).toBe('/effort ');

    input.value = '';
    expect(highlights.textContent).toBe('');
    expect(highlights.classList.contains('claudian-input-mention-highlights--empty')).toBe(true);

    highlighter.destroy();
    input.value = 'after destroy';
    expect(input.value).toBe('after destroy');
    wrapper.remove();
  });

  it('mirrors text inserted with setRangeText', () => {
    const { highlights, input, wrapper } = createFixture();
    const highlighter = new MentionTextHighlighter(input, highlights);
    input.value = 'Review ';
    input.setRangeText('@', 7, 7, 'end');

    expect(highlights.textContent).toBe('Review @');

    highlighter.destroy();
    wrapper.remove();
  });
});
