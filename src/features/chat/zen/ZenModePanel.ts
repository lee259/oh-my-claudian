import { Scope, setIcon } from 'obsidian';

import { t } from '@/i18n/i18n';

import type { ZenModeControllerOptions, ZenModeSource } from './ZenModeController';
import { ZenPanelDock } from './ZenPanelDock';

let sequence = 0;

/** Hosts the existing chat presentation; the source retains all runtime and editor state. */
export class ZenModePanel {
  readonly root: HTMLElement;
  private readonly disclosure: HTMLButtonElement;
  private readonly preview: HTMLElement;
  private readonly observer: MutationObserver;
  private readonly keyScope: Scope;
  private readonly dock: ZenPanelDock;
  private pushedScope = false;
  private expanded = false;
  private destroyed = false;
  private scrollPositions = new Map<HTMLElement, number>();

  constructor(
    host: HTMLElement,
    private readonly source: ZenModeSource,
    private readonly options: ZenModeControllerOptions,
    private readonly history: { expanded: boolean; onChange(expanded: boolean): void },
  ) {
    const doc = host.ownerDocument;
    this.root = host.createDiv();
    this.root.className = 'claudian-zen';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', t('chat.zen.regionLabel'));
    this.disclosure = this.root.createEl('button');
    this.disclosure.className = 'claudian-zen-disclosure';
    this.disclosure.type = 'button';
    const icon = this.disclosure.createSpan();
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, 'messages-square');
    this.preview = this.disclosure.createSpan();
    this.preview.className = 'claudian-zen-preview';
    const historyEl = source.surface.querySelector<HTMLElement>('.claudian-tab-content-container') ?? source.surface;
    historyEl.id ||= `claudian-zen-history-${++sequence}`;
    this.disclosure.setAttribute('aria-controls', historyEl.id);
    this.disclosure.addEventListener('click', () => this.toggleHistory());
    this.captureScroll();
    this.root.appendChild(source.surface);
    source.surface.classList.add('claudian-zen-surface');
    this.keyScope = new Scope(source.scope ?? options.app.scope);
    this.root.addEventListener('focusin', this.onFocusIn);
    this.root.addEventListener('focusout', this.onFocusOut);
    doc.addEventListener('pointerdown', this.onOutsidePointer, true);
    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(source.surface, { childList: true, characterData: true, subtree: true });
    const grip = this.root.createEl('button');
    grip.className = 'claudian-zen-grip';
    grip.type = 'button';
    grip.setAttribute('aria-label', t('chat.zen.move'));
    grip.title = t('chat.zen.move');
    setIcon(grip, 'grip-horizontal');
    this.dock = new ZenPanelDock(host, this.root, grip, options.getPosition(), position => options.savePosition(position));
    this.setExpanded(history.expanded);
    this.refresh();
  }

  refresh(): void {
    if (this.destroyed) return;
    const activity = this.source.getPreview();
    const hasHistory = activity.hasMessages || activity.requiresAction;
    this.root.classList.toggle('has-history', hasHistory);
    this.disclosure.hidden = !hasHistory;
    this.disclosure.disabled = !hasHistory;
    this.preview.textContent = activity.text || t('chat.zen.working');
    this.root.dataset.working = String(activity.working);
    this.root.dataset.attention = String(activity.requiresAction);
    if (activity.requiresAction && !this.expanded) this.setExpanded(true);
  }

  toggleHistory(): boolean {
    const activity = this.source.getPreview();
    if (!activity.hasMessages || activity.requiresAction) return false;
    this.setExpanded(!this.expanded);
    return true;
  }

  private setExpanded(expanded: boolean): void {
    if (!expanded && this.expanded) {
      this.captureScroll();
      const historyEl = this.source.surface.querySelector('.claudian-tab-content-container');
      if (historyEl?.contains(this.root.ownerDocument.activeElement)) this.disclosure.focus({ preventScroll: true });
    }
    this.expanded = expanded;
    this.history.onChange(expanded);
    this.root.classList.toggle('is-expanded', expanded);
    this.disclosure.setAttribute('aria-expanded', String(expanded));
    this.disclosure.setAttribute('aria-label', t(expanded ? 'chat.zen.hideHistory' : 'chat.zen.showHistory'));
    if (expanded) this.restoreScroll();
    this.dock?.refresh();
  }

  private captureScroll(): void {
    for (const element of this.source.surface.querySelectorAll<HTMLElement>('.claudian-messages')) {
      this.scrollPositions.set(element, element.scrollTop);
    }
  }

  private restoreScroll(): void {
    for (const [element, top] of this.scrollPositions) element.scrollTop = top;
  }

  private onFocusIn = (): void => {
    if (this.pushedScope) return;
    this.options.app.keymap?.pushScope(this.keyScope);
    this.pushedScope = true;
  };

  private onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget && this.root.contains(event.relatedTarget as Node)) return;
    this.popScope();
  };

  private popScope(): void {
    if (!this.pushedScope) return;
    this.options.app.keymap?.popScope(this.keyScope);
    this.pushedScope = false;
  }

  private onOutsidePointer = (event: PointerEvent): void => {
    const target = event.target as Element | null;
    if (!target || this.root.contains(target) || target.closest?.('.menu, .modal-container, .suggestion-container')) return;
    if (!this.source.getPreview().requiresAction) this.setExpanded(false);
  };

  destroy(origin: Comment): void {
    if (this.destroyed) return;
    if (this.expanded) this.captureScroll();
    origin.replaceWith(this.source.surface);
    this.destroyed = true;
    this.observer.disconnect();
    this.dock.destroy();
    this.popScope();
    this.root.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointer, true);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.source.surface.classList.remove('claudian-zen-surface');
    this.restoreScroll();
    this.root.remove();
  }
}
