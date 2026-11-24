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
  private minimizeButton: HTMLButtonElement | null = null;
  private readonly historyId: string;
  private readonly surfaceId: string;
  private readonly observer: MutationObserver;
  private readonly keyScope: Scope;
  private readonly dock: ZenPanelDock;
  private pushedScope = false;
  private expanded = false;
  private minimized = false;
  private destroyed = false;
  private scrollPositions = new Map<HTMLElement, number>();

  constructor(
    host: HTMLElement,
    private readonly source: ZenModeSource,
    private readonly options: ZenModeControllerOptions,
    private readonly history: { expanded: boolean; onChange(expanded: boolean): void },
  ) {
    this.root = host.createDiv();
    this.root.className = 'claudian-zen';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', t('chat.zen.regionLabel'));
    const historyEl = source.surface.querySelector<HTMLElement>('.claudian-tab-content-container') ?? source.surface;
    const id = ++sequence;
    historyEl.id ||= `claudian-zen-history-${id}`;
    source.conversationPicker.element.id ||= `claudian-zen-picker-${id}`;
    this.historyId = historyEl.id;
    this.surfaceId = `claudian-zen-slot-${id}`;
    this.captureScroll();
    this.view = createPreactRoot(this.root);
    this.render();
    source.surface.classList.add('claudian-zen-surface');
    this.keyScope = new Scope(source.scope ?? options.app.scope);
    this.root.addEventListener('focusin', this.onFocusIn);
    this.root.addEventListener('focusout', this.onFocusOut);
    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(source.surface, { childList: true, characterData: true, subtree: true });
    this.observer.observe(source.conversationPicker.element, { attributes: true, attributeFilter: ['class'] });
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
    if (activity.requiresAction && !this.minimized && !this.expanded) this.setExpanded(true);
    else this.render();
  }

  toggleHistory(checking = false): boolean {
    const activity = this.source.getPreview();
    if (this.minimized || !activity.hasMessages || activity.requiresAction) return false;
    if (!checking) this.setExpanded(!this.expanded);
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
    if (expanded && !this.minimized) this.restoreScroll();
    this.dock?.refresh();
  }

  private render(): void {
    this.view.render(h(ZenModePanelView, {
      activity: this.source.getPreview(),
      expanded: this.expanded,
      minimized: this.minimized,
      historyId: this.historyId,
      conversationPickerId: this.source.conversationPicker.element.id,
      conversationPickerOpen: this.source.conversationPicker.element.classList.contains('visible'),
      surface: this.source.surface,
      surfaceId: this.surfaceId,
      disclosureRef: this.setDisclosure,
      gripRef: this.setGrip,
      minimizeRef: this.setMinimizeButton,
      onToggleHistory: this.onToggleHistory,
      onToggleConversationPicker: this.onToggleConversationPicker,
      onToggleMinimized: this.onToggleMinimized,
    }));
  }

  private setDisclosure = (element: HTMLButtonElement | null): void => { this.disclosure = element; };
  private setGrip = (element: HTMLButtonElement | null): void => { this.grip = element; };
  private setMinimizeButton = (element: HTMLButtonElement | null): void => { this.minimizeButton = element; };
  private onToggleHistory = (): void => { this.toggleHistory(); };

  private onToggleConversationPicker = (trigger: HTMLButtonElement): void => {
    this.source.conversationPicker.toggle(trigger);
    this.refresh();
  };

  private onToggleMinimized = (): void => {
    if (!this.minimized) {
      this.source.conversationPicker.close();
      if (this.expanded) this.captureScroll();
    }
    this.minimized = !this.minimized;
    this.root.classList.toggle('is-minimized', this.minimized);
    this.refresh();
    this.dock.setMinimized(this.minimized);
    if (this.minimized) {
      this.minimizeButton?.focus({ preventScroll: true });
    } else {
      if (this.expanded) this.restoreScroll();
      this.source.focusInput();
    }
  };

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

  destroy(origin: Comment): void {
    if (this.destroyed) return;
    this.source.conversationPicker.close();
    if (this.expanded && !this.minimized) this.captureScroll();
    origin.replaceWith(this.source.surface);
    this.destroyed = true;
    this.observer.disconnect();
    this.dock.destroy();
    this.view.unmount();
    this.popScope();
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.source.surface.classList.remove('claudian-zen-surface');
    this.restoreScroll();
    this.root.remove();
  }
}
