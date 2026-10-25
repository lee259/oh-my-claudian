import { Scope } from 'obsidian';
import { h } from 'preact';

import { t } from '@/i18n/i18n';
import { createPreactRoot, type PreactRoot } from '@/shared/ui/PreactRoot';

import type { ZenModeControllerOptions, ZenModeSource } from './ZenModeController';
import { ZenModePanelView } from './ZenModePanelView';
import { ZenPanelDock } from './ZenPanelDock';

let sequence = 0;

/** Hosts the existing chat presentation; the source retains all runtime and editor state. */
export class ZenModePanel {
  readonly root: HTMLElement;
  private readonly view: PreactRoot;
  private disclosure: HTMLButtonElement | null = null;
  private grip: HTMLButtonElement | null = null;
  private readonly historyId: string;
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
    const historyEl = source.surface.querySelector<HTMLElement>('.claudian-tab-content-container') ?? source.surface;
    historyEl.id ||= `claudian-zen-history-${++sequence}`;
    this.historyId = historyEl.id;
    this.captureScroll();
    this.view = createPreactRoot(this.root);
    this.render();
    source.surface.classList.add('claudian-zen-surface');
    this.keyScope = new Scope(source.scope ?? options.app.scope);
    this.root.addEventListener('focusin', this.onFocusIn);
    this.root.addEventListener('focusout', this.onFocusOut);
    doc.addEventListener('pointerdown', this.onOutsidePointer, true);
    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(source.surface, { childList: true, characterData: true, subtree: true });
    this.dock = new ZenPanelDock(host, this.root, this.grip!, options.getPosition(), position => options.savePosition(position));
    this.setExpanded(history.expanded);
    this.refresh();
  }

  refresh(): void {
    if (this.destroyed) return;
    const activity = this.source.getPreview();
    const hasHistory = activity.hasMessages || activity.requiresAction;
    this.root.classList.toggle('has-history', hasHistory);
    this.root.dataset.working = String(activity.working);
    this.root.dataset.attention = String(activity.requiresAction);
    if (activity.requiresAction && !this.expanded) this.setExpanded(true);
    else this.render();
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
      if (historyEl?.contains(this.root.ownerDocument.activeElement)) this.disclosure?.focus({ preventScroll: true });
    }
    this.expanded = expanded;
    this.history.onChange(expanded);
    this.root.classList.toggle('is-expanded', expanded);
    this.render();
    if (expanded) this.restoreScroll();
    this.dock?.refresh();
  }

  private render(): void {
    this.view.render(h(ZenModePanelView, {
      activity: this.source.getPreview(),
      expanded: this.expanded,
      historyId: this.historyId,
      surface: this.source.surface,
      disclosureRef: this.setDisclosure,
      gripRef: this.setGrip,
      onToggleHistory: this.onToggleHistory,
    }));
  }

  private setDisclosure = (element: HTMLButtonElement | null): void => { this.disclosure = element; };
  private setGrip = (element: HTMLButtonElement | null): void => { this.grip = element; };
  private onToggleHistory = (): void => { this.toggleHistory(); };

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
    this.view.unmount();
    this.popScope();
    this.root.ownerDocument.removeEventListener('pointerdown', this.onOutsidePointer, true);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.source.surface.classList.remove('claudian-zen-surface');
    this.restoreScroll();
    this.root.remove();
  }
}
