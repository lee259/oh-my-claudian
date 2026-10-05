import type { App } from 'obsidian';
import { setIcon } from 'obsidian';

import type { ProviderCommandKind } from '../../../core/providers/commands/ProviderCommandEntry';

const FILE_MENTION_PATTERN = /@(?:[^\s@]+\.[^\s@]+|[^\s@/]+(?:\/[^\s@]+)*\/)/g;
const COMMAND_TOKEN_PATTERN = /(^|\s)([/$][^\s]+)(?=\s)/g;

/** Mirrors composer text and emphasizes file mentions plus known provider command tokens. */
export class MentionTextHighlighter {
  private readonly contentEl: HTMLElement;
  private readonly syncHandler = () => this.sync();
  private readonly scrollHandler = () => this.syncScroll();
  private readonly restoreProgrammaticWrites: () => void;

  constructor(
    private readonly inputEl: HTMLTextAreaElement,
    private readonly highlightEl: HTMLElement,
    private readonly app?: App,
    private readonly resolveCommandKind?: (token: string, atInputStart: boolean) => ProviderCommandKind | null,
  ) {
    this.highlightEl.addClass('claudian-input-mention-highlights');
    this.contentEl = this.highlightEl.createDiv({ cls: 'claudian-input-mention-highlights-content' });
    this.inputEl.addEventListener('input', this.syncHandler);
    this.inputEl.addEventListener('scroll', this.scrollHandler);
    this.inputEl.addEventListener('claudian:mention-inserted', this.syncHandler);
    this.restoreProgrammaticWrites = this.observeProgrammaticWrites();
    this.sync();
  }

  destroy(): void {
    this.restoreProgrammaticWrites();
    this.inputEl.removeEventListener('input', this.syncHandler);
    this.inputEl.removeEventListener('scroll', this.scrollHandler);
    this.inputEl.removeEventListener('claudian:mention-inserted', this.syncHandler);
    this.highlightEl.remove();
  }

  /**
   * The textarea text is transparent and this mirror draws it, so programmatic
   * writes (slash command selection, conversation resets, mode exits) must also
   * resync; they do not fire `input`. Instance-level overrides keep every
   * current and future caller covered without per-call-site events.
   */
  private observeProgrammaticWrites(): () => void {
    const input = this.inputEl;
    const valueDescriptor = findPropertyDescriptor(input, 'value');
    const rangeDescriptor = findPropertyDescriptor(input, 'setRangeText');
    const ownValue = Object.getOwnPropertyDescriptor(input, 'value');
    const ownSetRangeText = Object.getOwnPropertyDescriptor(input, 'setRangeText');
    const getValue: unknown = valueDescriptor && Reflect.get(valueDescriptor, 'get');
    const setValue: unknown = valueDescriptor && Reflect.get(valueDescriptor, 'set');
    const setRangeText: unknown = rangeDescriptor && Reflect.get(rangeDescriptor, 'value');

    if (typeof getValue === 'function' && typeof setValue === 'function') {
      Object.defineProperty(input, 'value', {
        configurable: true,
        enumerable: valueDescriptor?.enumerable ?? true,
        get: (): unknown => Reflect.apply(getValue, input, []),
        set: (value: string) => {
          Reflect.apply(setValue, input, [value]);
          this.sync();
        },
      });
    }

    if (typeof setRangeText === 'function') {
      Object.defineProperty(input, 'setRangeText', {
        configurable: true,
        value: (...args: unknown[]) => {
          Reflect.apply(setRangeText, input, args);
          this.sync();
        },
        writable: true,
      });
    }

    return () => {
      restoreOwnProperty(input, 'value', ownValue);
      restoreOwnProperty(input, 'setRangeText', ownSetRangeText);
    };
  }

  private sync(): void {
    const text = this.inputEl.value;
    this.highlightEl.classList.toggle('claudian-input-mention-highlights--empty', text.length === 0);
    this.contentEl.textContent = '';

    const highlights: Array<{ start: number; end: number; kind: 'mention' | ProviderCommandKind }> = [];
    for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
      const start = match.index ?? 0;
      highlights.push({ start, end: start + match[0].length, kind: 'mention' });
    }
    for (const match of text.matchAll(COMMAND_TOKEN_PATTERN)) {
      const prefix = match[1] ?? '';
      const token = match[2] ?? '';
      const start = (match.index ?? 0) + prefix.length;
      const kind = this.resolveCommandKind?.(token, start === 0);
      if (kind) highlights.push({ start, end: start + token.length, kind });
    }

    highlights.sort((left, right) => left.start - right.start);
    let cursor = 0;
    for (const highlight of highlights) {
      if (highlight.start < cursor) continue;
      if (highlight.start > cursor) this.contentEl.createSpan({ text: text.slice(cursor, highlight.start) });
      if (highlight.kind === 'mention') {
        this.appendMention(text.slice(highlight.start, highlight.end));
      } else {
        this.appendCommand(text.slice(highlight.start, highlight.end), highlight.kind);
      }
      cursor = highlight.end;
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
    const isFolder = mention.endsWith('/');
    const file = isFolder
      ? this.app?.vault.getAbstractFileByPath(normalizedPath)
      : this.app?.metadataCache.getFirstLinkpathDest(linkPath, '')
        ?? this.app?.vault.getAbstractFileByPath(normalizedPath);
    const mentionEl = this.contentEl.createSpan({
      cls: file ? 'claudian-input-mention-highlight internal-link' : 'claudian-input-mention-highlight',
      text: mention,
    });
    mentionEl.dataset.mentionKind = isFolder ? 'folder' : 'file';
    if (this.app) mentionEl.dataset.mentionState = file ? 'resolved' : 'missing';
    if (!file || !this.app) return;

    mentionEl.addClass('claudian-input-mention-highlight--clickable');
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

  private appendCommand(token: string, kind: ProviderCommandKind): void {
    const commandEl = this.contentEl.createSpan({
      cls: `claudian-input-command-highlight claudian-input-command-highlight--${kind}`,
    });
    commandEl.dataset.commandKind = kind;
    const prefixEl = commandEl.createSpan({
      cls: `claudian-input-command-highlight-prefix claudian-input-command-highlight-prefix--${kind}`,
      text: token[0],
    });
    if (kind === 'skill') {
      const iconEl = prefixEl.createSpan({ cls: 'claudian-input-command-highlight-icon' });
      setIcon(iconEl, 'zap');
    }
    commandEl.append(this.inputEl.ownerDocument.createTextNode(token.slice(1)));
  }
}

function findPropertyDescriptor(target: object, key: string): PropertyDescriptor | undefined {
  for (let current: object | null = target; current; current = Object.getPrototypeOf(current) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function restoreOwnProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}
