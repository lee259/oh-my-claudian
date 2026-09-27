/** @jest-environment jsdom */

import {
  appendQuoteToComposer,
  formatSelectionQuote,
  MessageQuoteController,
} from '@/features/chat/controllers/MessageQuoteController';

describe('MessageQuoteController', () => {
  let messagesEl: HTMLElement;
  let hostEl: HTMLElement;
  let contentEl: HTMLElement;
  let controller: MessageQuoteController;
  let onQuote: jest.Mock;

  beforeEach(() => {
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
    hostEl.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 500, bottom: 400, left: 0,
      width: 500, height: 400, toJSON: () => ({}),
    });
    controller = new MessageQuoteController({ messagesEl, label: 'Quote', onQuote });
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

  it('hides on Escape and removes its listeners and button when disposed', () => {
    select('selected text');
    const button = hostEl.querySelector<HTMLButtonElement>('.claudian-message-quote-btn');
    expect(button?.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button?.hidden).toBe(true);
    controller.dispose();
    expect(hostEl.querySelector('.claudian-message-quote-btn')).toBeNull();
    select('another selection');
    expect(hostEl.querySelector('.claudian-message-quote-btn')).toBeNull();
  });
});
