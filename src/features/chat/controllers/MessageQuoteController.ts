const MESSAGE_SELECTOR = '.claudian-message';
const CONTENT_SELECTOR = '.claudian-message-content';
const BUTTON_GAP_PX = 6;
const EDGE_PADDING_PX = 8;

export interface MessageQuoteControllerOptions {
  messagesEl: HTMLElement;
  label: string;
  onQuote: (text: string) => void;
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
export function appendQuoteToComposer(inputEl: HTMLTextAreaElement, quote: string): void {
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

/** Offers a floating action for text selected inside one rendered message. */
export class MessageQuoteController {
  readonly #messagesEl: HTMLElement;
  readonly #label: string;
  readonly #onQuote: (text: string) => void;
  #buttonEl: HTMLButtonElement | null = null;
  #disposed = false;

  readonly #onMouseUp = (): void => this.#showForCurrentSelection();
  readonly #onSelectionChange = (): void => {
    if (this.#buttonEl && !this.#buttonEl.hidden) this.#showForCurrentSelection();
  };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.#hide();
  };
  readonly #onScroll = (): void => this.#hide();

  constructor(options: MessageQuoteControllerOptions) {
    this.#messagesEl = options.messagesEl;
    this.#label = options.label;
    this.#onQuote = options.onQuote;

    const doc = this.#messagesEl.ownerDocument;
    this.#messagesEl.addEventListener('mouseup', this.#onMouseUp);
    this.#messagesEl.addEventListener('scroll', this.#onScroll, { passive: true });
    doc.addEventListener('selectionchange', this.#onSelectionChange);
    doc.addEventListener('keydown', this.#onKeyDown);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const doc = this.#messagesEl.ownerDocument;
    this.#messagesEl.removeEventListener('mouseup', this.#onMouseUp);
    this.#messagesEl.removeEventListener('scroll', this.#onScroll);
    doc.removeEventListener('selectionchange', this.#onSelectionChange);
    doc.removeEventListener('keydown', this.#onKeyDown);
    this.#buttonEl?.remove();
    this.#buttonEl = null;
  }

  #showForCurrentSelection(): void {
    const range = this.#getMessageSelectionRange();
    const hostEl = this.#messagesEl.parentElement;
    if (!range || !hostEl) {
      this.#hide();
      return;
    }

    const button = this.#ensureButton(hostEl);
    if (!this.#position(button, hostEl, range)) {
      this.#hide();
      return;
    }
    button.hidden = false;
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

  #ensureButton(hostEl: HTMLElement): HTMLButtonElement {
    if (this.#buttonEl?.parentElement === hostEl) return this.#buttonEl;
    this.#buttonEl?.remove();

    const button = hostEl.createEl('button', {
      cls: 'claudian-message-quote-btn',
      attr: { type: 'button', 'aria-label': this.#label },
    });
    button.addClass('claudian-message-quote-btn--floating');
    button.title = this.#label;
    button.hidden = true;
    button.textContent = this.#label;
    // Preserve the browser selection until the click handler reads it.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#quote();
    });
    hostEl.append(button);
    this.#buttonEl = button;
    return button;
  }

  #position(button: HTMLButtonElement, hostEl: HTMLElement, range: Range): boolean {
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

  #quote(): void {
    const selection = this.#messagesEl.ownerDocument.getSelection();
    const text = this.#getMessageSelectionRange() ? selection?.toString() ?? '' : '';
    selection?.removeAllRanges();
    this.#hide();
    if (text) this.#onQuote(text);
  }

  #hide(): void {
    if (this.#buttonEl) this.#buttonEl.hidden = true;
  }
}
