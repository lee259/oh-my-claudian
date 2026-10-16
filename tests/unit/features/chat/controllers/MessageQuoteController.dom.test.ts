/** @jest-environment jsdom */

import { htmlToMarkdown } from 'obsidian';

import {
  appendQuoteToComposer,
  formatSelectionQuote,
  MessageQuoteController,
} from '@/features/chat/controllers/MessageQuoteController';

jest.mock('obsidian', () => ({
  ...jest.requireActual('obsidian'),
  // Conversion belongs to the host; assert the selected HTML passed to it below.
  htmlToMarkdown: jest.fn((html: HTMLElement) => html.textContent ?? ''),
}));

describe('MessageQuoteController', () => {
  let messagesEl: HTMLElement;
  let hostEl: HTMLElement;
  let contentEl: HTMLElement;
  let controller: MessageQuoteController;
  let onQuote: jest.Mock;
  let onSave: jest.Mock;

  beforeEach(() => {
    jest.mocked(htmlToMarkdown).mockReset().mockImplementation(html => (html as HTMLElement).textContent ?? '');
    hostEl = document.createElement('div');
    messagesEl = document.createElement('div');
    messagesEl.className = 'claudian-messages';
    contentEl = document.createElement('div');
    contentEl.className = 'claudian-message-content';
    const messageEl = document.createElement('div');
    messageEl.className = 'claudian-message claudian-message-assistant';
    messageEl.append(contentEl);
    messagesEl.append(messageEl);
    hostEl.append(messagesEl);
    document.body.append(hostEl);
    onQuote = jest.fn();
    onSave = jest.fn();
    hostEl.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 500, bottom: 400, left: 0,
      width: 500, height: 400, toJSON: () => ({}),
    });
    controller = new MessageQuoteController({ messagesEl, label: 'Quote', onQuote,
      saveSelection: { label: 'Save to note', onSave } });
  });

  afterEach(() => {
    controller.dispose();
    hostEl.remove();
    window.getSelection()?.removeAllRanges();
  });

  function select(text: string): void {
    const textNode = document.createTextNode(text);
    contentEl.append(textNode);
    const range = document.createRange();
    range.selectNodeContents(textNode);
    range.getClientRects = () => [{
      x: 20, y: 30, top: 30, right: 160, bottom: 50, left: 20,
      width: 140, height: 20, toJSON: () => ({}),
    }] as unknown as DOMRectList;
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  it('formats selected lines as a Markdown blockquote', () => {
    expect(formatSelectionQuote('first\r\n\r\nthird')).toBe('> first\n>\n> third');
  });

  it('appends the quote after a draft, leaves a blank line, and notifies composer listeners', () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.value = 'Please explain this';
    const inputListener = jest.fn();
    input.addEventListener('input', inputListener);

    appendQuoteToComposer(input, '> selected text');

    expect(input.value).toBe('Please explain this\n\n> selected text\n\n');
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('shows a non-focus-stealing quote button for text selected in message content', () => {
    select('selected text');

    const button = hostEl.querySelector<HTMLButtonElement>('.claudian-message-quote-btn');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Quote');
    expect(button?.hidden).toBe(false);
    expect(button?.getAttribute('aria-label')).toBe('Quote');

    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button?.click();
    expect(onQuote).toHaveBeenCalledWith('selected text');
  });

  it('does not offer quoting for a selection outside message content', () => {
    const outsideText = document.createTextNode('outside text');
    hostEl.append(outsideText);
    const range = document.createRange();
    range.selectNodeContents(outsideText);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(hostEl.querySelector('.claudian-message-quote-btn')).toBeNull();
  });

  it('offers saving alongside quoting and passes only the selected text', () => {
    contentEl.textContent = 'Before. Keep this part. After.';
    const node = contentEl.firstChild!;
    const range = document.createRange();
    range.setStart(node, 8);
    range.setEnd(node, 23);
    range.getClientRects = () => [{ top: 30, right: 160, bottom: 50, left: 20 }] as unknown as DOMRectList;
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const quote = hostEl.querySelector<HTMLButtonElement>('.claudian-message-quote-btn')!;
    const save = hostEl.querySelector<HTMLButtonElement>('.claudian-message-save-selection-btn')!;
    expect(save).not.toBeNull();
    expect(save.parentElement).toBe(quote.parentElement);
    save.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    save.click();
    expect(onSave).toHaveBeenCalledWith('Keep this part.');
    expect(onQuote).not.toHaveBeenCalled();
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it('does not save a stale selection that was cleared before clicking', () => {
    select('Selected answer');
    const save = hostEl.querySelector<HTMLButtonElement>('.claudian-message-save-selection-btn')!;
    window.getSelection()?.removeAllRanges();
    save.click();
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    ['heading', '<h2>Before selected after</h2>', 'h2', '<h2>selected</h2>', '## selected'],
    ['nested link', '<p>Before <strong><a href="https://example.com">Before selected after</a></strong> after</p>', 'a', '<p><strong><a href="https://example.com">selected</a></strong></p>', '**[selected](https://example.com)**'],
    ['list', '<ul><li>Before</li><li>Before selected after</li><li>After</li></ul>', 'li:nth-child(2)', '<ul><li>selected</li></ul>', '- selected'],
    ['code', '<div class="claudian-code-wrapper"><div class="claudian-code-header">typescript<button>Copy</button></div><pre><code class="language-typescript"><span>Before selected after</span></code></pre></div>', 'code span', '<div class="claudian-code-wrapper"><pre><code class="language-typescript"><span>selected</span></code></pre></div>', '```typescript\nselected\n```'],
  ])('saves partial %s selections with their formatting and without surrounding text', (_name, html, selector, expectedHtml, markdown) => {
    contentEl.innerHTML = html;
    const node = contentEl.querySelector(selector)!.firstChild!;
    const start = node.textContent!.indexOf('selected');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'selected'.length);
    range.getClientRects = () => [{ top: 30, right: 160, bottom: 50, left: 20 }] as unknown as DOMRectList;
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    jest.mocked(htmlToMarkdown).mockReturnValue(markdown);

    hostEl.querySelector<HTMLButtonElement>('.claudian-message-save-selection-btn')!.click();

    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
    expect((jest.mocked(htmlToMarkdown).mock.calls[0][0] as HTMLElement).innerHTML).toBe(expectedHtml);
    expect(onSave).toHaveBeenCalledWith(markdown);
    expect(onQuote).not.toHaveBeenCalled();
  });

  it('keeps quoting as plain text without converting it to Markdown', () => {
    contentEl.innerHTML = '<p><strong>selected</strong></p>';
    const range = document.createRange();
    range.selectNodeContents(contentEl.querySelector('strong')!);
    range.getClientRects = () => [{ top: 30, right: 160, bottom: 50, left: 20 }] as unknown as DOMRectList;
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    hostEl.querySelector<HTMLButtonElement>('.claudian-message-quote-btn')!.click();

    expect(onQuote).toHaveBeenCalledWith('selected');
    expect(htmlToMarkdown).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps task state (%s) when only part of its formatted text is selected', (checked) => {
    contentEl.innerHTML = '<ul><li class="task-list-item"><input type="checkbox"><strong>Before selected after</strong></li><li>Unselected task</li></ul>';
    // Live checkbox state can differ from its original HTML attribute.
    contentEl.querySelector<HTMLInputElement>('input')!.checked = checked;
    const node = contentEl.querySelector('strong')!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 7);
    range.setEnd(node, 15);
    range.getClientRects = () => [{ top: 30, right: 160, bottom: 50, left: 20 }] as unknown as DOMRectList;
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const markdown = `- [${checked ? 'x' : ' '}] **selected**`;
    jest.mocked(htmlToMarkdown).mockReturnValue(markdown);

    hostEl.querySelector<HTMLButtonElement>('.claudian-message-save-selection-btn')!.click();

    const selectedHtml = jest.mocked(htmlToMarkdown).mock.calls[0][0] as HTMLElement;
    const checkbox = selectedHtml.querySelector<HTMLInputElement>('li > input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.hasAttribute('checked')).toBe(checked);
    expect(selectedHtml.textContent).toBe('selected');
    expect(selectedHtml.querySelectorAll('li')).toHaveLength(1);
    expect(onSave).toHaveBeenCalledWith(markdown);
  });

  it('keeps each task state when a selection crosses task items', () => {
    contentEl.innerHTML = '<ul><li>Before</li><li><input type="checkbox" checked>First selected</li><li><input type="checkbox">Second selected after</li><li>After</li></ul>';
    const range = document.createRange();
    range.setStart(contentEl.querySelector('li:nth-child(2)')!.lastChild!, 6);
    range.setEnd(contentEl.querySelector('li:nth-child(3)')!.lastChild!, 15);
    range.getClientRects = () => [{ top: 30, right: 160, bottom: 50, left: 20 }] as unknown as DOMRectList;
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    hostEl.querySelector<HTMLButtonElement>('.claudian-message-save-selection-btn')!.click();

    const selectedHtml = jest.mocked(htmlToMarkdown).mock.calls[0][0] as HTMLElement;
    const checkboxes = Array.from(selectedHtml.querySelectorAll('li > input[type="checkbox"]'));
    expect(checkboxes.map(checkbox => checkbox.hasAttribute('checked'))).toEqual([true, false]);
    expect(selectedHtml.textContent).toBe('selectedSecond selected');
    expect(selectedHtml.querySelectorAll('li')).toHaveLength(2);
  });

  it('preserves a selection spanning blocks and excludes code controls from the saved content', () => {
    contentEl.innerHTML = '<h2>Heading</h2><p><strong>Bold</strong></p><div class="claudian-code-wrapper"><div class="claudian-code-header">typescript<button>Copy</button></div><pre><code class="language-typescript">const answer = 42;</code></pre></div>';
    const range = document.createRange();
    range.selectNodeContents(contentEl);
    range.getClientRects = () => [{ top: 30, right: 160, bottom: 50, left: 20 }] as unknown as DOMRectList;
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const markdown = '## Heading\n\n**Bold**\n\n```typescript\nconst answer = 42;\n```';
    jest.mocked(htmlToMarkdown).mockReturnValue(markdown);

    hostEl.querySelector<HTMLButtonElement>('.claudian-message-save-selection-btn')!.click();

    const selectedHtml = jest.mocked(htmlToMarkdown).mock.calls[0][0] as HTMLElement;
    expect(selectedHtml.querySelector('.claudian-code-header, button')).toBeNull();
    expect(selectedHtml.querySelector('h2')?.textContent).toBe('Heading');
    expect(selectedHtml.querySelector('strong')?.textContent).toBe('Bold');
    expect(selectedHtml.querySelector('code')?.className).toBe('language-typescript');
    expect(onSave).toHaveBeenCalledWith(markdown);
  });

  it.each(['scroll', 'resize'])('dismisses both actions when the window receives %s', (event) => {
    select('Selected answer');
    const menu = hostEl.querySelector<HTMLElement>('.claudian-message-selection-actions')!;
    expect(menu.hidden).toBe(false);
    window.dispatchEvent(new Event(event));
    expect(menu.hidden).toBe(true);
  });

  it('does not show actions for a selection crossing two messages', () => {
    select('First message');
    const other = document.createElement('div');
    other.className = 'claudian-message claudian-message-assistant';
    const otherContent = other.createDiv({ cls: 'claudian-message-content', text: 'Second message' });
    messagesEl.append(other);
    const range = document.createRange();
    range.setStart(contentEl.firstChild!, 0);
    range.setEnd(otherContent.firstChild!, 6);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(hostEl.querySelector<HTMLElement>('.claudian-message-selection-actions')?.hidden).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('hides on Escape and removes its listeners and button when disposed', () => {
    select('selected text');
    const button = hostEl.querySelector<HTMLButtonElement>('.claudian-message-quote-btn');
    expect(button?.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button?.closest<HTMLElement>('.claudian-message-selection-actions')?.hidden).toBe(true);
    controller.dispose();
    expect(hostEl.querySelector('.claudian-message-quote-btn')).toBeNull();
    select('another selection');
    expect(hostEl.querySelector('.claudian-message-quote-btn')).toBeNull();
  });
});
