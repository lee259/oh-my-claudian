import { Menu } from 'obsidian';
import { h } from 'preact';

import { t } from '@/i18n/i18n';
import { createPreactRoot, type PreactRoot } from '@/shared/ui/PreactRoot';

import type { FollowUpItem, FollowUpQueue } from '../state/FollowUpQueue';
import { FollowUpQueuePanel } from './FollowUpQueuePanel';

export interface FollowUpQueueActions {
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
  onResume: () => void;
  onEdit: (id: string) => void;
}

/** Adapts runtime subscriptions and host menus to the Preact-owned queue surface. */
export class FollowUpQueueView {
  private canSteer = false;
  private isIdle = false;
  private unavailableReason = '';
  private readonly viewRoot: PreactRoot;
  private readonly detach: () => void;

  constructor(
    readonly root: HTMLElement,
    private readonly queue: FollowUpQueue,
    private readonly actions: FollowUpQueueActions,
  ) {
    this.viewRoot = createPreactRoot(root);
    this.detach = queue.subscribe(() => this.render());
    this.root.setAttribute('tabindex', '-1');
    this.render();
  }

  update(canSteer: boolean, unavailableReason = '', isIdle = false): void {
    this.isIdle = isIdle;
    this.canSteer = canSteer;
    this.unavailableReason = unavailableReason;
    this.render();
  }

  destroy(): void { this.detach(); this.viewRoot.unmount(); }

  private findFocus(id: string): HTMLElement | undefined {
    return Array.from(this.root.querySelectorAll<HTMLElement>('[data-focus]'))
      .find(element => element.getAttribute('data-focus') === id);
  }

  private showMenu(item: FollowUpItem, anchor: HTMLElement): void {
    const menu = new Menu();
    menu.addItem(entry => entry.setTitle(t('common.edit')).setIcon('pencil')
      .onClick(() => this.actions.onEdit(item.id)));
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
  }

  private render(): void {
    const active = this.root.ownerDocument?.activeElement as HTMLElement | null;
    const focusId = this.root.contains?.(active) ? active?.getAttribute('data-focus') : null;
    const items = this.queue.items.filter(item => item.status === 'queued' || item.status === 'uncertain');
    this.root.toggleClass('claudian-hidden', items.length === 0);
    this.root.toggleClass('claudian-visible-block', items.length > 0);
    this.viewRoot.render(h(FollowUpQueuePanel, {
      items,
      paused: this.queue.paused,
      showResume: this.queue.paused || (this.isIdle && this.queue.next !== null),
      canSteer: this.canSteer,
      unavailableReason: this.unavailableReason,
      onSteer: this.actions.onSteer,
      onRemove: this.actions.onRemove,
      onResume: this.actions.onResume,
      onMore: (item, anchor) => this.showMenu(item, anchor),
      onDismiss: id => this.queue.remove(id),
      onMove: (id, direction) => {
        this.queue.move(id, direction);
        this.findFocus(`${id}:reorder`)?.focus();
      },
      onMoveTo: (id, targetId, after) => {
        this.queue.moveTo(id, targetId, after);
        this.findFocus(`${id}:reorder`)?.focus();
      },
    }));
    if (focusId) this.findFocus(focusId)?.focus();
  }
}
