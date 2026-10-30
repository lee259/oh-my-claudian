import { h } from 'preact';

import { createPreactRoot, type PreactRoot } from '@/shared/ui/PreactRoot';

import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { ComposerContextTrayView,type ContextTrayLayout } from './ComposerContextTrayView';

export type ComposerContextSlot =
  | 'current-note'
  | 'files'
  | 'external-contexts'
  | 'message-quotes'
  | 'editor-selection'
  | 'browser-selection'
  | 'canvas-selection'
  | 'images';

export type ComposerContextItemKind = 'note' | 'file' | 'folder' | 'selection' | 'image';

export interface ComposerContextPreview {
  heading: string;
  content: string;
  deleteLabel: string;
  onDelete: () => void;
}

export interface ComposerContextItem {
  id: string;
  kind: ComposerContextItemKind;
  label: string;
  icon?: string;
  title?: string;
  ariaLabel?: string;
  removeLabel?: string;
  preview?: ComposerContextPreview;
  onActivate?: () => void;
  onRemove?: () => void;
}

export interface ComposerContextTrayOptions {
  onDidChange?: () => void;
}

const SLOT_ORDER: readonly ComposerContextSlot[] = [
  'current-note',
  'files',
  'external-contexts',
  'message-quotes',
  'editor-selection',
  'browser-selection',
  'canvas-selection',
  'images',
];

function samePresentation(left: readonly ComposerContextItem[], right: readonly ComposerContextItem[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const next = right[index];
    return item.id === next.id && item.kind === next.kind && item.label === next.label
      && item.icon === next.icon && item.title === next.title && item.ariaLabel === next.ariaLabel
      && item.removeLabel === next.removeLabel && Boolean(item.onActivate) === Boolean(next.onActivate)
      && Boolean(item.onRemove) === Boolean(next.onRemove)
      && item.preview?.heading === next.preview?.heading && item.preview?.content === next.preview?.content
      && item.preview?.deleteLabel === next.preview?.deleteLabel
      && Boolean(item.preview) === Boolean(next.preview);
  });
}

const MAX_COLLAPSED_ROWS = 1;
const ROW_OVERLAP_TOLERANCE = 1;

interface ContextTrayRow {
  top: number;
  bottom: number;
  firstIndex: number;
  lastIndex: number;
}

/**
 * Owns composer context layout while context managers retain their data and behavior.
 */
export class ComposerContextTray {
  private readonly containerEl: HTMLElement;
  private readonly options: ComposerContextTrayOptions;
  private readonly root: PreactRoot;
  private layout: ContextTrayLayout = { hiddenIndices: new Set(), showMore: false, expanded: false };
  private destroyed = false;
  private readonly itemsBySlot = new Map<ComposerContextSlot, ComposerContextItem[]>();
  private resizeObserver: ResizeObserver | null = null;
  private pendingLayout: ScheduledAnimationFrame | null = null;
  private expanded = false;

  constructor(containerEl: HTMLElement, options: ComposerContextTrayOptions = {}) {
    this.containerEl = containerEl;
    this.options = options;
    this.containerEl.addClass('claudian-context-row');
    this.root = createPreactRoot(containerEl);
    this.observeSize();
    this.render();
  }

  setItems(slot: ComposerContextSlot, items: readonly ComposerContextItem[]): void {
    if (this.destroyed) return;
    const previous = this.itemsBySlot.get(slot) ?? [];
    const unchanged = samePresentation(previous, items);
    if (items.length === 0) {
      this.itemsBySlot.delete(slot);
    } else {
      this.itemsBySlot.set(slot, [...items]);
    }
    if (unchanged) {
      this.renderView();
      return;
    }
    this.expanded = false;
    this.render();
  }

  clearItems(slot: ComposerContextSlot): void {
    if (!this.itemsBySlot.delete(slot)) return;
    this.expanded = false;
    this.render();
  }

  refreshLayout(): void {
    if (this.destroyed) return;
    const chips = Array.from(
      this.containerEl.querySelectorAll<HTMLElement>('.claudian-context-chip')
    );
    const moreButton = this.containerEl.querySelector<HTMLElement>('.claudian-context-more');
    if (!moreButton || chips.length === 0) return;

    const oldHidden = chips.map(chip => chip.classList.contains('claudian-context-chip--overflow-hidden'));
    const moreWasHidden = moreButton.classList.contains('claudian-hidden');
    for (const chip of chips) {
      chip.removeClass('claudian-context-chip--overflow-hidden');
    }
    moreButton.addClass('claudian-hidden');

    const rows = this.getRows(chips);
    const hasOverflow = rows.length > MAX_COLLAPSED_ROWS;
    let visibleCount = chips.length;
    if (hasOverflow && !this.expanded) {
      moreButton.removeClass('claudian-hidden');
      const lastVisibleRow = rows[MAX_COLLAPSED_ROWS - 1];
      visibleCount = lastVisibleRow.lastIndex + 1;
      for (let index = visibleCount; index < chips.length; index++) {
        chips[index].addClass('claudian-context-chip--overflow-hidden');
      }
      const minimumVisibleCount = Math.max(1, lastVisibleRow.firstIndex);
      while (visibleCount > minimumVisibleCount && moreButton.offsetTop >= lastVisibleRow.bottom) {
        visibleCount -= 1;
        chips[visibleCount].addClass('claudian-context-chip--overflow-hidden');
      }
    }
    // Restore the DOM before rendering so Preact's previous virtual state stays accurate.
    chips.forEach((chip, index) => chip.classList.toggle('claudian-context-chip--overflow-hidden', oldHidden[index]));
    moreButton.classList.toggle('claudian-hidden', moreWasHidden);
    if (!hasOverflow) this.expanded = false;
    this.layout = {
      hiddenIndices: new Set(Array.from({ length: chips.length - visibleCount }, (_, index) => visibleCount + index)),
      showMore: hasOverflow,
      expanded: this.expanded,
    };
    this.containerEl.toggleClass('claudian-context-row--expanded', this.expanded);
    this.renderView();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.pendingLayout) {
      cancelScheduledAnimationFrame(this.pendingLayout);
      this.pendingLayout = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.itemsBySlot.clear();
    this.root.unmount();
    this.containerEl.removeClass('has-content');
    this.containerEl.removeClass('claudian-context-row--expanded');
  }

  private render(): void {
    if (this.destroyed) return;
    this.layout = { hiddenIndices: new Set(), showMore: false, expanded: false };
    this.containerEl.removeClass('claudian-context-row--expanded');
    this.renderView();
    this.options.onDidChange?.();
    this.scheduleLayout();
  }

  private renderView(): void {
    const entries = SLOT_ORDER.flatMap(slot =>
      (this.itemsBySlot.get(slot) ?? []).map(item => ({ item, slot }))
    );
    this.containerEl.toggleClass('has-content', entries.length > 0);
    this.root.render(h(ComposerContextTrayView, {
      entries,
      layout: this.layout,
      onToggleMore: () => {
        this.expanded = !this.expanded;
        this.refreshLayout();
        this.options.onDidChange?.();
      },
      onAlignPreview: chip => this.alignPreview(chip),
    }));
  }

  private alignPreview(chip: HTMLElement): void {
    const trayRect = this.containerEl.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const previewWidth = Math.min(760, Math.max(0, trayRect.width - 20));
    const centeredLeft = chipRect.left - trayRect.left + chipRect.width / 2 - previewWidth / 2;
    const left = Math.min(Math.max(centeredLeft, 10), Math.max(10, trayRect.width - previewWidth - 10));
    const chipOffset = chipRect.left - trayRect.left;
    chip.style.setProperty('--claudian-context-preview-left', `${Math.round(left - chipOffset)}px`);
  }

  private getRows(chips: readonly HTMLElement[]): ContextTrayRow[] {
    const rows: ContextTrayRow[] = [];
    for (const [index, chip] of chips.entries()) {
      const top = chip.offsetTop;
      const height = chip.offsetHeight > 0 ? chip.offsetHeight : 1;
      const bottom = top + height;
      const row = rows.find(candidate =>
        top < candidate.bottom + ROW_OVERLAP_TOLERANCE
        && bottom > candidate.top - ROW_OVERLAP_TOLERANCE
      );
      if (row) {
        row.top = Math.min(row.top, top);
        row.bottom = Math.max(row.bottom, bottom);
        row.lastIndex = index;
      } else {
        rows.push({ top, bottom, firstIndex: index, lastIndex: index });
      }
    }
    return rows.sort((left, right) => left.top - right.top);
  }

  private scheduleLayout(): void {
    if (this.destroyed) return;
    if (this.pendingLayout) {
      cancelScheduledAnimationFrame(this.pendingLayout);
    }
    this.pendingLayout = scheduleAnimationFrame(() => {
      this.pendingLayout = null;
      this.refreshLayout();
    }, this.containerEl.ownerDocument.defaultView);
  }

  private observeSize(): void {
    const ResizeObserverConstructor = this.containerEl.ownerDocument.defaultView?.ResizeObserver;
    if (typeof ResizeObserverConstructor !== 'function') return;

    this.resizeObserver = new ResizeObserverConstructor(() => this.scheduleLayout());
    this.resizeObserver.observe(this.containerEl);
  }
}
