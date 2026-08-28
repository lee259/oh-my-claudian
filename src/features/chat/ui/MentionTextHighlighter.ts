const FILE_MENTION_PATTERN = /@(?:[^\s@]+\.[^\s@]+|[^\s@/]+(?:\/[^\s@]+)*\/)/g;

/** Mirrors composer text beneath its textarea and emphasizes file-like @mentions. */
export class MentionTextHighlighter {
  private readonly contentEl: HTMLElement;
  private readonly syncHandler = () => this.sync();
  private readonly scrollHandler = () => this.syncScroll();

  constructor(
    private readonly inputEl: HTMLTextAreaElement,
    private readonly highlightEl: HTMLElement,
  ) {
    this.contentEl = this.highlightEl.createDiv({ cls: 'claudian-input-mention-highlights-content' });
    this.inputEl.addEventListener('input', this.syncHandler);
    this.inputEl.addEventListener('scroll', this.scrollHandler);
    this.inputEl.addEventListener('claudian:mention-inserted', this.syncHandler);
    this.sync();
  }

  destroy(): void {
    this.inputEl.removeEventListener('input', this.syncHandler);
    this.inputEl.removeEventListener('scroll', this.scrollHandler);
    this.inputEl.removeEventListener('claudian:mention-inserted', this.syncHandler);
    this.highlightEl.remove();
  }

  private sync(): void {
    const text = this.inputEl.value;
    this.highlightEl.classList.toggle('claudian-input-mention-highlights--empty', text.length === 0);
    this.contentEl.textContent = '';

    let cursor = 0;
    for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
      const start = match.index ?? 0;
      if (start > cursor) this.contentEl.createSpan({ text: text.slice(cursor, start) });
      this.contentEl.createSpan({
        cls: 'claudian-input-mention-highlight',
        text: match[0],
      });
      cursor = start + match[0].length;
    }
    if (cursor < text.length) this.contentEl.createSpan({ text: text.slice(cursor) });
    this.syncScroll();
  }

  private syncScroll(): void {
    this.contentEl.style.transform = `translate(${-this.inputEl.scrollLeft}px, ${-this.inputEl.scrollTop}px)`;
  }
}
