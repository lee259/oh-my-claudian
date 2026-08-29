import type { App } from 'obsidian';

const FILE_MENTION_PATTERN = /@(?:[^\s@]+\.[^\s@]+|[^\s@/]+(?:\/[^\s@]+)*\/)/g;

/** Mirrors composer text beneath its textarea and emphasizes file-like @mentions. */
export class MentionTextHighlighter {
  private readonly contentEl: HTMLElement;
  private readonly syncHandler = () => this.sync();
  private readonly scrollHandler = () => this.syncScroll();

  constructor(
    private readonly inputEl: HTMLTextAreaElement,
    private readonly highlightEl: HTMLElement,
    private readonly app?: App,
  ) {
    this.highlightEl.style.zIndex = '2';
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
      this.appendMention(match[0]);
      cursor = start + match[0].length;
    }
    if (cursor < text.length) this.contentEl.createSpan({ text: text.slice(cursor) });
    this.syncScroll();
  }

  private syncScroll(): void {
    this.contentEl.style.transform = `translate(${-this.inputEl.scrollLeft}px, ${-this.inputEl.scrollTop}px)`;
  }

  private appendMention(mention: string): void {
    const linkPath = mention.slice(1);
    const normalizedPath = linkPath.replace(/\/$/, '');
    const file = this.app?.metadataCache.getFirstLinkpathDest(linkPath, '')
      ?? this.app?.vault.getAbstractFileByPath(normalizedPath);
    const mentionEl = this.contentEl.createSpan({
      cls: file ? 'claudian-input-mention-highlight internal-link' : 'claudian-input-mention-highlight',
      text: mention,
    });
    if (!file || !this.app) return;

    mentionEl.style.pointerEvents = 'auto';
    mentionEl.style.cursor = 'pointer';
    const isFolder = mention.endsWith('/');
    mentionEl.setAttribute('data-href', normalizedPath);
    mentionEl.setAttribute('href', normalizedPath);
    if (isFolder) mentionEl.setAttribute('data-claudian-folder-link', 'true');
    mentionEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isFolder) {
        const folder = this.app?.vault.getAbstractFileByPath(normalizedPath);
        for (const leaf of this.app?.workspace.getLeavesOfType('file-explorer') ?? []) {
          (leaf.view as unknown as { revealInFolder?: (target: unknown) => void }).revealInFolder?.(folder);
        }
      } else {
        void this.app?.workspace.openLinkText(normalizedPath, '', 'tab');
      }
    });
  }
}
