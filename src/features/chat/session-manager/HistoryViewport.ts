export interface HistoryViewportOptions {
  showSessionSections: boolean;
  showArchivedSection: boolean;
  hasPinnedSection?: boolean;
  historyHeaderLabel?: string;
}

export interface HistoryViewportLayout {
  list: HTMLElement;
  sessionList: HTMLElement;
  pinnedList: HTMLElement | null;
}

export interface HistoryScrollAnchor {
  conversationId: string;
  viewportOffset: number;
}

export interface HistoryViewportSnapshot {
  sessionScrollTop: number;
  pinnedScrollTop: number;
  previousVisibleCount: number;
  sessionScrollAnchors: HistoryScrollAnchor[];
}

export class HistoryViewport {
  capture(container: HTMLElement, preserveListState: boolean): HistoryViewportSnapshot {
    const previousList = preserveListState
      ? container.querySelector<HTMLElement>('.claudian-history-list')
      : null;
    const previousSessionList = previousList?.querySelector<HTMLElement>(
      '.claudian-session-list-items',
    ) ?? previousList;
    const previousPinnedSection = previousList?.querySelector<HTMLElement>(
      '.claudian-history-section--pinned',
    );
    const previousPinnedList = previousPinnedSection?.querySelector<HTMLElement>(
      '.claudian-history-section-items',
    );
    const previousVisibleCountFromState = Number(previousList?.dataset.visibleCount);
    const previousVisibleCount = Number.isFinite(previousVisibleCountFromState)
      && previousVisibleCountFromState > 0
      ? previousVisibleCountFromState
      : previousList?.querySelectorAll('.claudian-history-item').length ?? 0;

    return {
      sessionScrollTop: previousSessionList?.scrollTop ?? 0,
      pinnedScrollTop: previousPinnedList?.scrollTop ?? 0,
      previousVisibleCount,
      sessionScrollAnchors: previousSessionList
        ? this.captureScrollAnchors(previousSessionList)
        : [],
    };
  }

  createLayout(
    container: HTMLElement,
    options: HistoryViewportOptions,
  ): HistoryViewportLayout {
    let list: HTMLElement;
    let sessionList: HTMLElement;
    let pinnedList: HTMLElement | null = null;

    if (options.showSessionSections) {
      list = container.createDiv({ cls: 'claudian-history-list' });
      if (options.hasPinnedSection) {
        const pinnedSection = list.createDiv({
          cls: 'claudian-history-section claudian-history-section--pinned',
        });
        pinnedSection.createDiv({
          cls: 'claudian-history-header claudian-session-section-header',
        }).createSpan({
          cls: 'claudian-history-section-label',
          text: 'Pinned',
        });
        pinnedList = pinnedSection.createDiv({
          cls: 'claudian-history-section-items',
        });
      }

      const sessionsSection = list.createDiv({
        cls: [
          'claudian-history-section',
          options.showArchivedSection
            ? 'claudian-history-section--archived'
            : 'claudian-history-section--sessions',
        ].join(' '),
      });
      sessionsSection.createDiv({
        cls: 'claudian-history-header claudian-session-section-header claudian-session-list-header',
      }).createSpan({
        cls: 'claudian-history-section-label',
        text: options.showArchivedSection ? 'Archived' : 'Sessions',
      });
      sessionList = sessionsSection.createDiv({
        cls: 'claudian-history-section-items claudian-session-list-items',
      });
    } else {
      const dropdownHeader = container.createDiv({ cls: 'claudian-history-header' });
      dropdownHeader.createSpan({ text: options.historyHeaderLabel ?? 'Sessions' });
      list = container.createDiv({ cls: 'claudian-history-list' });
      sessionList = list;
    }

    return { list, sessionList, pinnedList };
  }

  setVisibleCount(list: HTMLElement, visibleCount: number): void {
    list.dataset.visibleCount = String(visibleCount);
  }

  restore(
    layout: Pick<HistoryViewportLayout, 'sessionList' | 'pinnedList'>,
    snapshot: HistoryViewportSnapshot,
  ): void {
    if (layout.pinnedList) layout.pinnedList.scrollTop = snapshot.pinnedScrollTop;
    this.restoreScrollPosition(
      layout.sessionList,
      snapshot.sessionScrollTop,
      snapshot.sessionScrollAnchors,
    );
  }

  private captureScrollAnchors(list: HTMLElement): HistoryScrollAnchor[] {
    const listRect = list.getBoundingClientRect();
    if (listRect.height <= 0) return [];

    return Array.from(list.querySelectorAll<HTMLElement>('.claudian-history-item'))
      .map((item): HistoryScrollAnchor | null => {
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
      .filter((anchor): anchor is HistoryScrollAnchor => anchor !== null);
  }

  private restoreScrollPosition(
    list: HTMLElement,
    previousScrollTop: number,
    anchors: readonly HistoryScrollAnchor[],
  ): void {
    list.scrollTop = previousScrollTop;
    if (anchors.length === 0) return;

    const items = Array.from(
      list.querySelectorAll<HTMLElement>('.claudian-history-item'),
    );
    const listTop = list.getBoundingClientRect().top;
    for (const anchor of anchors) {
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
}
