import { htmlToMarkdown, setIcon } from 'obsidian';

import type { ComposerInputElement } from '@/shared/components/ComposerInput';

const MESSAGE_SELECTOR = '.claudian-message';
const CONTENT_SELECTOR = '.claudian-message-content';
const BUTTON_GAP_PX = 6;
const EDGE_PADDING_PX = 8;

export interface MessageQuoteControllerOptions {
  messagesEl: HTMLElement;
  label: string;
  onQuote: (text: string) => void;
  saveSelection?: { label: string; onSave: (text: string) => void };
}

/** Formats selected message text as a Markdown blockquote. */
export function formatSelectionQuote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n');
}

/** Appends a quote block to the composer and leaves the caret below it. */
export function appendQuoteToComposer(inputEl: ComposerInputElement, quote: string): void {
  const currentValue = inputEl.value;
  let separator = '';
  if (currentValue.trim()) {
    if (currentValue.endsWith('\n\n')) separator = '';
    else if (currentValue.endsWith('\n')) separator = '\n';
    else separator = '\n\n';
  }

  inputEl.value = `${currentValue}${separator}${quote}\n\n`;
  const cursorPosition = inputEl.value.length;
  inputEl.selectionStart = cursorPosition;
  inputEl.selectionEnd = cursorPosition;

  const EventConstructor = inputEl.ownerDocument.defaultView?.Event ?? Event;
  inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  inputEl.focus();
}

/** Offers quoting and optional note saving for text selected inside one message. */
export class MessageQuoteController {
  readonly #messagesEl: HTMLElement;
  readonly #label: string;
  readonly #onQuote: (text: string) => void;
  readonly #saveSelection: MessageQuoteControllerOptions['saveSelection'];
  #menuEl: HTMLElement | null = null;
  #disposed = false;

  readonly #onMouseUp = (): void => this.#showForCurrentSelection();
  readonly #onSelectionChange = (): void => {
    if (this.#menuEl && !this.#menuEl.hidden) this.#showForCurrentSelection();
  };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.#hide();
  };
  readonly #onScroll = (): void => this.#hide();

  constructor(options: MessageQuoteControllerOptions) {
    this.#messagesEl = options.messagesEl;
    this.#label = options.label;
    this.#onQuote = options.onQuote;
    this.#saveSelection = options.saveSelection;

    const doc = this.#messagesEl.ownerDocument;
    this.#messagesEl.addEventListener('mouseup', this.#onMouseUp);
    this.#messagesEl.addEventListener('scroll', this.#onScroll, { passive: true });
    doc.addEventListener('selectionchange', this.#onSelectionChange);
    doc.addEventListener('keydown', this.#onKeyDown);
    doc.defaultView?.addEventListener('resize', this.#onScroll);
    doc.defaultView?.addEventListener('scroll', this.#onScroll, true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const doc = this.#messagesEl.ownerDocument;
    this.#messagesEl.removeEventListener('mouseup', this.#onMouseUp);
    this.#messagesEl.removeEventListener('scroll', this.#onScroll);
    doc.removeEventListener('selectionchange', this.#onSelectionChange);
    doc.removeEventListener('keydown', this.#onKeyDown);
    doc.defaultView?.removeEventListener('resize', this.#onScroll);
    doc.defaultView?.removeEventListener('scroll', this.#onScroll, true);
    this.#menuEl?.remove();
    this.#menuEl = null;
  }

  #showForCurrentSelection(): void {
    const range = this.#getMessageSelectionRange();
    const hostEl = this.#messagesEl.parentElement;
    if (!range || !hostEl) {
      this.#hide();
      return;
    }

    const menu = this.#ensureMenu(hostEl);
    menu.hidden = false;
    if (!this.#position(menu, hostEl, range)) {
      this.#hide();
      return;
    }
  }

  #getMessageSelectionRange(): Range | null {
    const selection = this.#messagesEl.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const startContent = this.#closestMessageContent(range.startContainer);
    const endContent = this.#closestMessageContent(range.endContainer);
    return startContent && startContent === endContent && selection.toString().trim() ? range : null;
  }

  #closestMessageContent(node: Node): HTMLElement | null {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const contentEl = element?.closest<HTMLElement>(CONTENT_SELECTOR);
    const messageEl = contentEl?.closest(MESSAGE_SELECTOR);
    return contentEl && messageEl && this.#messagesEl.contains(messageEl) ? contentEl : null;
  }

  #ensureMenu(hostEl: HTMLElement): HTMLElement {
    if (this.#menuEl?.parentElement === hostEl) return this.#menuEl;
    this.#menuEl?.remove();
    const menu = hostEl.createDiv({
      cls: 'claudian-message-selection-actions',
      attr: { role: 'group', 'aria-label': [this.#label, this.#saveSelection?.label].filter(Boolean).join(' / ') },
    });
    this.#addAction(menu, this.#label, 'quote', 'claudian-message-quote-btn', this.#onQuote, 'text');
    if (this.#saveSelection) {
      this.#addAction(menu, this.#saveSelection.label, 'file-plus-2', 'claudian-message-save-selection-btn', this.#saveSelection.onSave, 'markdown');
    }
    this.#menuEl = menu;
    return menu;
  }

  #addAction(menu: HTMLElement, label: string, icon: string, cls: string, action: (text: string) => void, format: 'text' | 'markdown'): void {
    const button = menu.createEl('button', {
      cls: `claudian-message-selection-action ${cls}`,
      attr: { type: 'button', 'aria-label': label, title: label },
    });
    setIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), icon);
    button.createSpan({ text: label });
    // Preserve the browser selection until the click handler reads it.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#act(action, format);
    });
  }

  #position(button: HTMLElement, hostEl: HTMLElement, range: Range): boolean {
    const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
    const anchor = rects.at(-1);
    if (!anchor) return false;

    const hostRect = hostEl.getBoundingClientRect();
    const buttonWidth = button.offsetWidth;
    const buttonHeight = button.offsetHeight;
    let top = anchor.bottom - hostRect.top + BUTTON_GAP_PX;
    if (top + buttonHeight > hostRect.height - EDGE_PADDING_PX) {
      top = rects[0].top - hostRect.top - buttonHeight - BUTTON_GAP_PX;
    }
    const maxLeft = Math.max(EDGE_PADDING_PX, hostRect.width - buttonWidth - EDGE_PADDING_PX);
    const left = Math.min(
      Math.max(anchor.right - hostRect.left - buttonWidth / 2, EDGE_PADDING_PX),
      maxLeft,
    );

    button.style.setProperty('--claudian-quote-btn-top', `${Math.round(Math.max(top, EDGE_PADDING_PX))}px`);
    button.style.setProperty('--claudian-quote-btn-left', `${Math.round(left)}px`);
    return true;
  }

  #act(action: (text: string) => void, format: 'text' | 'markdown'): void {
    const selection = this.#messagesEl.ownerDocument.getSelection();
    const range = this.#getMessageSelectionRange();
    const text = range
      ? format === 'markdown' ? this.#selectionMarkdown(range) : selection?.toString() ?? ''
      : '';
    selection?.removeAllRanges();
    this.#hide();
    if (text) action(text);
  }

  #selectionMarkdown(range: Range): string {
    const contentEl = this.#closestMessageContent(range.startContainer)!;
    let fragment: Node = range.cloneContents();
    // cloneContents omits common ancestors, such as a link or code block when
    // only part of its text is selected. Restore their structure, not siblings.
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType !== 1) ancestor = ancestor.parentNode!;
    while (ancestor !== contentEl) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(fragment);
      fragment = wrapper;
      ancestor = ancestor.parentNode!;
    }
    const container = createDiv();
    container.appendChild(fragment);
    container.querySelectorAll('.claudian-code-header, button').forEach(element => element.remove());
    // A text selection omits the task checkbox sibling. Pair the retained list
    // items in document order and restore only their live checkbox state.
    const sourceItems = Array.from(contentEl.querySelectorAll('li')).filter(item => range.intersectsNode(item));
    container.querySelectorAll('li').forEach((item, index) => {
      const sourceCheckbox = sourceItems[index]?.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]');
      if (!sourceCheckbox) return;
      let checkbox = item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]');
      if (!checkbox) {
        checkbox = sourceCheckbox.cloneNode(false) as HTMLInputElement;
        item.prepend(checkbox);
      }
      checkbox.toggleAttribute('checked', sourceCheckbox.checked);
    });
    return htmlToMarkdown(container);
  }

  #hide(): void {
    if (this.#menuEl) this.#menuEl.hidden = true;
  }
}
