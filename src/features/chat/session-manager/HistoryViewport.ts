import { t } from '../../../i18n/i18n';

export interface HistoryViewportOptions {
  historyHeaderLabel?: string;
  showHistoryHeader?: boolean;
}

export interface HistoryViewportSnapshot {
  scrollTop: number;
  previousVisibleCount: number;
  scrollAnchors: Array<{ conversationId: string; viewportOffset: number }>;
}

export function buildHistoryRenderKey(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export class HistoryViewport {
  beginRender(container: HTMLElement, preserveListState: boolean): HTMLElement {
    if (!preserveListState) {
      container.empty();
      return container;
    }

    return container.createDiv({ cls: 'claudian-history-render-staging' });
  }

  commit(container: HTMLElement, renderRoot: HTMLElement): void {
    if (renderRoot === container) return;

    const previousItems = new Map(
      Array.from(container.querySelectorAll<HTMLElement>('[data-history-render-key]'))
        .map(item => [item.getAttribute('data-history-render-key'), item] as const)
        .filter((entry): entry is readonly [string, HTMLElement] => entry[0] !== null),
    );
    for (const item of Array.from(renderRoot.querySelectorAll<HTMLElement>('[data-history-render-key]'))) {
      const renderKey = item.getAttribute('data-history-render-key');
      const previousItem = renderKey ? previousItems.get(renderKey) : undefined;
      if (!previousItem || typeof item.replaceWith !== 'function') continue;
      item.replaceWith(previousItem);
    }

    const stagedChildren = Array.from(renderRoot.children);
    container.empty();
    for (const child of stagedChildren) {
      container.appendChild(child);
    }
    renderRoot.remove();
  }

  capture(container: HTMLElement, preserveListState: boolean): HistoryViewportSnapshot {
    const list = preserveListState
      ? container.querySelector<HTMLElement>('.claudian-history-list')
      : null;
    const visibleCountFromState = Number(list?.dataset.visibleCount);
    const previousVisibleCount = Number.isFinite(visibleCountFromState)
      && visibleCountFromState > 0
      ? visibleCountFromState
      : list?.querySelectorAll('.claudian-history-item').length ?? 0;

    return {
      scrollTop: list?.scrollTop ?? 0,
      previousVisibleCount,
      scrollAnchors: list ? this.captureScrollAnchors(list) : [],
    };
  }

  createLayout(container: HTMLElement, options: HistoryViewportOptions): HTMLElement {
    if (options.showHistoryHeader !== false) {
      const header = container.createDiv({ cls: 'claudian-history-header' });
      header.createSpan({ text: options.historyHeaderLabel ?? t('chat.history.sessions') });
    }
    return container.createDiv({ cls: 'claudian-history-list' });
  }

  setVisibleCount(list: HTMLElement, visibleCount: number): void {
    list.dataset.visibleCount = String(visibleCount);
  }

  restore(list: HTMLElement, snapshot: HistoryViewportSnapshot): void {
    list.scrollTop = snapshot.scrollTop;
    if (snapshot.scrollAnchors.length === 0) return;

    const items = Array.from(list.querySelectorAll<HTMLElement>('.claudian-history-item'));
    const listTop = list.getBoundingClientRect().top;
    for (const anchor of snapshot.scrollAnchors) {
      const item = items.find(candidate => (
        candidate.getAttribute('data-conversation-id') === anchor.conversationId
      ));
      if (!item) continue;

      const itemRect = item.getBoundingClientRect();
      if (itemRect.height <= 0) continue;
      list.scrollTop += itemRect.top - listTop - anchor.viewportOffset;
      return;
    }
  }

  private captureScrollAnchors(
    list: HTMLElement,
  ): Array<{ conversationId: string; viewportOffset: number }> {
    const listRect = list.getBoundingClientRect();
    if (listRect.height <= 0) return [];

    return Array.from(list.querySelectorAll<HTMLElement>('.claudian-history-item'))
      .map((item) => {
        const conversationId = item.getAttribute('data-conversation-id');
        const itemRect = item.getBoundingClientRect();
        if (
          !conversationId
          || itemRect.height <= 0
          || itemRect.bottom <= listRect.top
          || itemRect.top >= listRect.bottom
        ) return null;
        return {
          conversationId,
          viewportOffset: itemRect.top - listRect.top,
        };
      })
      .filter((anchor): anchor is { conversationId: string; viewportOffset: number } => anchor !== null);
  }
}
