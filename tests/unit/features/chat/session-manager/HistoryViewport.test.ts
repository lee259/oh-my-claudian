import { createMockEl } from '@test/helpers/MockElement';

import { HistoryViewport } from '@/features/chat/session-manager/HistoryViewport';

describe('HistoryViewport', () => {
  it('captures and restores list scroll state and visible count', () => {
    const viewport = new HistoryViewport();
    const container = createMockEl();
    const list = container.createDiv({ cls: 'claudian-history-list' });
    const sessionList = list.createDiv({ cls: 'claudian-session-list-items' });
    list.dataset.visibleCount = '50';
    sessionList.scrollTop = 320;

    const snapshot = viewport.capture(container, true);
    const layout = viewport.createLayout(container, {
      showSessionSections: false,
      showArchivedSection: false,
    });
    viewport.setVisibleCount(layout.list, snapshot.previousVisibleCount);
    viewport.restore(layout, snapshot);

    expect(snapshot.previousVisibleCount).toBe(50);
    expect(layout.list.dataset.visibleCount).toBe('50');
    expect(layout.sessionList.scrollTop).toBe(320);
  });

  it('creates separate pinned and session viewports for sectioned history', () => {
    const viewport = new HistoryViewport();
    const container = createMockEl();

    const layout = viewport.createLayout(container, {
      showSessionSections: true,
      showArchivedSection: true,
      hasPinnedSection: true,
    });

    expect(layout.pinnedList).not.toBeNull();
    expect(layout.list.querySelector('.claudian-history-section--archived')).not.toBeNull();
    expect(layout.sessionList.hasClass('claudian-session-list-items')).toBe(true);
  });
});
