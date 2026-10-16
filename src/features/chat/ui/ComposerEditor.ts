import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, placeholder, WidgetType } from '@codemirror/view';
import { type App, setIcon } from 'obsidian';

import type { ProviderCommandKind } from '@/core/providers/commands/ProviderCommandEntry';
import type { ComposerInputElement } from '@/shared/components/ComposerInput';
import { filterMarkdownTextTokens } from '@/utils/markdownTextTokens';
import { isExternalTextFilePath, openAgentSkillByName, openVaultFile } from '@/utils/obsidianCompat';

import { type ComposerFileMention, findComposerFileMentions } from './ComposerMentionTokens';

const programmatic = Annotation.define<boolean>();
const refreshPresentation = StateEffect.define<null>();
const relationshipAttributes = ['aria-autocomplete', 'aria-activedescendant', 'aria-controls', 'aria-haspopup'];

class FileMentionWidget extends WidgetType {
  constructor(private readonly mention: ComposerFileMention, private readonly app: App) { super(); }

  eq(other: FileMentionWidget): boolean {
    return this.mention.path === other.mention.path && this.mention.label === other.mention.label;
  }

  toDOM(view: EditorView): HTMLElement {
    const ownerWindow = (view.dom.ownerDocument.win ?? view.dom.ownerDocument.defaultView) as Window & { createSpan: typeof createSpan };
    const link = ownerWindow.createSpan();
    link.className = 'claudian-composer-file internal-link';
    link.setAttribute('role', 'link');
    link.setAttribute('tabindex', '0');
    link.setAttribute('aria-label', this.mention.path);
    link.setAttribute('data-href', this.mention.path);
    link.setAttribute('title', this.mention.path);
    const icon = link.createSpan({ cls: 'claudian-composer-file-icon' });
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, 'file-text');
    link.createSpan({ cls: 'claudian-composer-file-name', text: this.mention.label });
    const open = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.app.workspace.openLinkText(this.mention.path, '', 'tab');
    };
    link.addEventListener('click', open);
    link.addEventListener('keydown', event => {
      if (!event.isComposing && (event.key === 'Enter' || event.key === ' ')) open(event);
    });
    return link;
  }
}

class CommandWidget extends WidgetType {
  constructor(private readonly token: string, private readonly kind: ProviderCommandKind, private readonly app: App) { super(); }
  eq(other: CommandWidget): boolean { return this.token === other.token && this.kind === other.kind; }
  toDOM(view: EditorView): HTMLElement {
    const ownerWindow = (view.dom.ownerDocument.win ?? view.dom.ownerDocument.defaultView) as Window & { createSpan: typeof createSpan };
    const el = ownerWindow.createSpan();
    el.className = 'claudian-input-command-highlight';
    const prefix = el.createSpan({ cls: 'claudian-input-command-highlight-prefix', text: this.kind === 'skill' ? '' : this.token[0] });
    if (this.kind === 'skill') {
      setIcon(prefix.createSpan({ cls: 'claudian-composer-file-icon' }), 'zap');
      el.addClass('claudian-input-command-highlight--clickable');
      el.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void openAgentSkillByName(this.app, this.token.slice(1).replace(/^skill:/u, ''));
      });
    }
    el.append(view.dom.ownerDocument.createTextNode(this.token.slice(1)));
    return el;
  }
}

/** Owns canonical @path text; short labels are editor decorations, never stored aliases. */
export class ComposerEditor {
  readonly element: ComposerInputElement;
  private state: EditorState;
  private view: EditorView | null = null;
  private destroyed = false;
  private inputPending = false;
  private composing = false;
  private readonly compositionStart = () => { this.composing = true; };
  private readonly compositionEnd = () => { this.composing = false; };
  private readonly guardComposition = (event: KeyboardEvent) => {
    // Stop shortcut routing without preventing the input method's default candidate action.
    if (this.composing || event.isComposing || event.keyCode === 229) event.stopImmediatePropagation();
  };
  private placeholderText = 'Ask to make changes, @mention files, run /commands';
  private readonly placeholderConfig = new Compartment();
  private readonly historyConfig = new Compartment();
  private commandResolver: ((token: string, atInputStart: boolean) => ProviderCommandKind | null) | null = null;
  private readonly decorations: StateField<DecorationSet>;

  constructor(parent: HTMLElement, private readonly app: App) {
    const host = parent.createDiv({
      cls: 'claudian-input claudian-composer-editor',
      attr: { role: 'textbox', 'aria-label': 'Message', 'aria-multiline': 'true', tabindex: '0', dir: 'auto' },
    });
    this.element = host as unknown as ComposerInputElement;
    this.decorations = StateField.define<DecorationSet>({
      create: state => this.decorate(state, Decoration.none),
      update: (previous, transaction) => this.decorate(transaction.state, previous.map(transaction.changes)),
      provide: field => EditorView.decorations.from(field),
    });
    this.state = EditorState.create({ extensions: [
      this.decorations,
      this.historyConfig.of(history()),
      this.placeholderConfig.of(placeholder(this.placeholderText)),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'Message', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true', autocorrect: 'on' }),
      EditorView.domEventHandlers({
        input: event => { event.stopPropagation(); return false; },
        keydown: event => {
          if (event.target !== this.view?.contentDOM) return false;
          if (event.defaultPrevented) { event.stopPropagation(); return true; }
          // Existing chat controllers decide completion, send and modes before editor defaults.
          const EventConstructor = host.ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent;
          const routed = new EventConstructor('keydown', {
            key: event.key, code: event.code, keyCode: event.keyCode, shiftKey: event.shiftKey,
            altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
            isComposing: event.isComposing, repeat: event.repeat, bubbles: true, cancelable: true,
          });
          host.dispatchEvent(routed);
          event.stopPropagation();
          if (routed.defaultPrevented) { event.preventDefault(); return true; }
          return false;
        },
        click: event => this.openPath(event),
      }),
      keymap.of([
        { key: 'Enter', run: insertNewline, shift: insertNewline },
        { key: 'Backspace', run: view => {
          const selection = view.state.selection.main;
          if (!selection.empty) return false;
          let start: number | null = null;
          view.state.field(this.decorations).between(selection.head, selection.head, (from, to, decoration) => {
            if (to === selection.head && decoration.spec.widget) start = from;
          });
          if (start === null) return false;
          view.dispatch({ changes: { from: start, to: selection.head }, selection: { anchor: start }, userEvent: 'delete.backward' });
          return true;
        } },
        ...historyKeymap, ...defaultKeymap,
      ]),
      EditorView.updateListener.of(update => {
        this.state = update.state;
        if (update.docChanged && !update.transactions.every(transaction => transaction.annotation(programmatic))) this.scheduleInput();
      }),
    ] });
    Object.defineProperties(host, {
      value: { configurable: true, get: () => this.state.doc.toString(), set: (value: string) => {
        this.apply(this.state.update({
          changes: { from: 0, to: this.state.doc.length, insert: value }, selection: { anchor: value.length },
          effects: this.historyConfig.reconfigure([]), annotations: [programmatic.of(true), Transaction.addToHistory.of(false)],
        }));
        this.apply(this.state.update({ effects: this.historyConfig.reconfigure(history()) }));
      } },
      selectionStart: { get: () => this.state.selection.main.from, set: (value: number) => this.setSelection(value, Math.max(value, this.state.selection.main.to)) },
      selectionEnd: { get: () => this.state.selection.main.to, set: (value: number) => this.setSelection(Math.min(value, this.state.selection.main.from), value) },
      placeholder: { get: () => this.placeholderText, set: (value: string) => {
        this.placeholderText = value;
        host.setAttribute('data-placeholder', value);
        this.apply(this.state.update({ effects: this.placeholderConfig.reconfigure(placeholder(value)) }));
      } },
    });
    this.element.setSelectionRange = (from, to) => this.setSelection(from, to);
    this.element.replaceText = (from, to, text) => this.replaceText(from, to, text);
    this.element.setRangeText = (text, from = this.state.selection.main.from, to = this.state.selection.main.to, mode = 'preserve') => {
      const selection = this.state.selection.main;
      this.replaceText(from, to, text);
      if (mode === 'select') this.setSelection(from, from + text.length);
      else if (mode === 'start') this.setSelection(from, from);
      else if (mode === 'preserve') {
        const map = (position: number) => position <= from ? position : position >= to ? position + text.length - (to - from) : from + text.length;
        this.setSelection(map(selection.from), map(selection.to));
      }
    };
    this.element.getAccessibleTextbox = () => this.view?.contentDOM ?? host;
    this.element.isChipRange = (from, to) => {
      let found = false;
      this.state.field(this.decorations).between(from, to, (start, end, decoration) => {
        if (start === from && end === to && decoration.spec.widget) found = true;
      });
      return found;
    };
    this.element.setCommandResolver = resolve => { this.commandResolver = resolve; this.apply(this.state.update({ effects: refreshPresentation.of(null) })); };
    this.element.isCaretOnEdgeRow = direction => {
      const view = this.view;
      if (!view) return null;
      const cursor = view.coordsAtPos(view.state.selection.main.head);
      const edge = view.coordsAtPos(direction === 'up' ? 0 : view.state.doc.length);
      return cursor && edge ? direction === 'up' ? cursor.top < edge.bottom : cursor.bottom > edge.top : null;
    };
    const blurHost = host.blur.bind(host);
    const focusHost = host.focus.bind(host);
    this.element.focus = options => {
      if (host.nodeType === 1) this.mount();
      else focusHost(options);
    };
    this.element.blur = () => this.view ? this.view.contentDOM.blur() : blurHost();
    host.setAttribute('data-placeholder', this.placeholderText);
    host.addEventListener('focusin', this.mount);
    host.addEventListener('focus', this.mount);
    host.addEventListener('compositionstart', this.compositionStart);
    host.addEventListener('compositionend', this.compositionEnd);
    host.addEventListener('keydown', this.guardComposition, true);
    this.element.addEventListener('claudian:mention-inserted', this.refresh);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.removeEventListener('focusin', this.mount);
    this.element.removeEventListener('focus', this.mount);
    this.element.removeEventListener('compositionstart', this.compositionStart);
    this.element.removeEventListener('compositionend', this.compositionEnd);
    this.element.removeEventListener('keydown', this.guardComposition, true);
    this.element.removeEventListener('claudian:mention-inserted', this.refresh);
    this.view?.destroy();
    this.view = null;
  }

  private readonly refresh = () => this.apply(this.state.update({ effects: refreshPresentation.of(null) }));
  private readonly mount = (event?: FocusEvent) => {
    if (this.destroyed || event && event.target !== this.element) return;
    if (!this.view) {
      this.element.textContent = '';
      this.element.addClass('is-mounted');
      this.element.removeAttribute('role');
      this.element.removeAttribute('aria-label');
      this.element.removeAttribute('aria-multiline');
      this.element.setAttribute('tabindex', '-1');
      this.view = new EditorView({ state: this.state, parent: this.element });
      for (const attr of relationshipAttributes) {
        const value = this.element.getAttribute(attr);
        if (value !== null) { this.view.contentDOM.setAttribute(attr, value); this.element.removeAttribute(attr); }
      }
    }
    this.view.focus();
  };

  private resolveFile(path: string): { path: string; name: string } | null {
    const file = this.app.vault?.getAbstractFileByPath(path);
    if (file && 'extension' in file) return file;
    const linkedFile = this.app.metadataCache?.getFirstLinkpathDest(path, '');
    // Implicit .md lookup must not reinterpret bare MCP or agent mentions as files.
    const name = path.slice(path.lastIndexOf('/') + 1);
    return linkedFile?.name.toLocaleLowerCase() === name.toLocaleLowerCase() ? linkedFile : null;
  }

  private decorate(state: EditorState, previous: DecorationSet): DecorationSet {
    const text = state.doc.toString();
    const files = findComposerFileMentions(text, path => this.resolveFile(path));
    const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
    const completed = (from: number, to: number) => {
      if (state.selection.ranges.some(range => range.from > from && range.from < to || range.to > from && range.to < to)) return false;
      if (to < text.length) return true;
      let wasWidget = false;
      previous.between(from, to, (start, end, decoration) => { if (start === from && end === to && decoration.spec.widget) wasWidget = true; });
      return wasWidget;
    };
    for (const file of files) {
      const to = file.index + file.fullMatch.length;
      if (completed(file.index, to)) ranges.push({ from: file.index, to, decoration: Decoration.replace({ widget: new FileMentionWidget(file, this.app) }) });
    }
    for (const match of text.matchAll(/(^|\s)([/$][^\s]+)(?=\s)/g)) {
      const from = match.index + match[1].length, token = match[2], to = from + token.length;
      const kind = this.commandResolver?.(token, from === 0);
      if (kind && completed(from, to)) ranges.push({ from, to, decoration: Decoration.replace({ widget: new CommandWidget(token, kind, this.app) }) });
    }
    for (const match of filterMarkdownTextTokens(text, [...text.matchAll(/@(?:[^\s@]+\.[^\s@]+|[^\s@/]+(?:\/[^\s@]+)*\/)/g)].map(match => ({ index: match.index, fullMatch: match[0] })))) {
      const from = match.index, to = from + match.fullMatch.length;
      if (from > 0 && !/\s/.test(text[from - 1]) || files.some(file => from < file.index + file.fullMatch.length && to > file.index)) continue;
      const path = match.fullMatch.slice(1), folder = path.endsWith('/'), normalized = folder ? path.slice(0, -1) : path;
      const resolved = folder ? !!this.app.vault?.getAbstractFileByPath(normalized) : isExternalTextFilePath(normalized);
      ranges.push({ from, to, decoration: Decoration.mark({ class: resolved ? 'claudian-composer-path-link' : 'claudian-composer-path-missing', attributes: resolved ? { 'data-composer-path': normalized, 'data-composer-folder': String(folder), title: normalized } : {} }) });
    }
    const filtered = filterMarkdownTextTokens(text, ranges.map(range => ({ ...range, index: range.from, fullMatch: text.slice(range.from, range.to) })));
    return Decoration.set(filtered.map(range => range.decoration.range(range.from, range.to)), true);
  }

  private openPath(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    const link = target?.closest<HTMLElement>('[data-composer-path]');
    if (!link) return false;
    event.preventDefault();
    event.stopPropagation();
    const path = link.dataset.composerPath!;
    if (link.dataset.composerFolder === 'true') {
      const folder = this.app.vault.getAbstractFileByPath(path);
      for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
        (leaf.view as unknown as { revealInFolder?: (target: unknown) => void }).revealInFolder?.(folder);
      }
    } else void openVaultFile(this.app, path);
    return true;
  }

  private replaceText(from: number, to: number, text: string): void {
    this.apply(this.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, annotations: programmatic.of(true), userEvent: 'input.complete' }));
  }
  private setSelection(from: number, to: number): void {
    const clamp = (position: number) => Math.max(0, Math.min(position, this.state.doc.length));
    this.apply(this.state.update({ selection: EditorSelection.single(clamp(from), clamp(to)) }));
  }
  private apply(transaction: Transaction): void {
    if (this.destroyed) return;
    if (this.view) this.view.dispatch(transaction);
    else {
      this.state = transaction.state;
      this.element.textContent = this.state.doc.toString();
    }
  }
  private scheduleInput(): void {
    if (this.inputPending) return;
    this.inputPending = true;
    queueMicrotask(() => {
      this.inputPending = false;
      const EventConstructor = this.element.ownerDocument.defaultView?.Event ?? Event;
      if (!this.destroyed) this.element.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    });
  }
}
