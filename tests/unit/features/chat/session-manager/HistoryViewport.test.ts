import { createMockEl } from '@test/helpers/MockElement';

import { HistoryViewport } from '@/features/chat/session-manager/HistoryViewport';

describe('HistoryViewport', () => {
  it('captures and restores list scroll state and visible count', () => {
    const viewport = new HistoryViewport();
    const container = createMockEl();
    const list = container.createDiv({ cls: 'claudian-history-list' });
    list.dataset.visibleCount = '50';
    list.scrollTop = 320;

    const snapshot = viewport.capture(container, true);
    const nextList = viewport.createLayout(container, { showHistoryHeader: false });
    viewport.setVisibleCount(nextList, snapshot.previousVisibleCount);
    viewport.restore(nextList, snapshot);

    expect(snapshot.previousVisibleCount).toBe(50);
    expect(nextList.dataset.visibleCount).toBe('50');
    expect(nextList.scrollTop).toBe(320);
  });

  it('creates a single history list with its header', () => {
    const viewport = new HistoryViewport();
    const container = createMockEl();

    const list = viewport.createLayout(container, { historyHeaderLabel: 'Sessions' });

    expect(container.querySelectorAll('.claudian-history-list')).toHaveLength(1);
    expect(container.querySelector('.claudian-history-header')).not.toBeNull();
    expect(list.hasClass('claudian-history-list')).toBe(true);
  });

  it('reuses keyed history items while committing a staged render', () => {
    const viewport = new HistoryViewport();
    const previousItem = {
      getAttribute: (name: string) => name === 'data-history-render-key' ? 'session-1' : null,
    } as unknown as HTMLElement;
    const renderRoot = {
      children: [] as HTMLElement[],
      querySelectorAll: () => renderRoot.children,
      remove: jest.fn(),
    } as unknown as HTMLElement & { children: HTMLElement[] };
    const nextItem = {
      getAttribute: (name: string) => name === 'data-history-render-key' ? 'session-1' : null,
      replaceWith: jest.fn((replacement: HTMLElement) => {
        renderRoot.children[0] = replacement;
      }),
    } as unknown as HTMLElement;
    renderRoot.children.push(nextItem);
    const container = {
      children: [previousItem],
      querySelectorAll: () => [previousItem],
      empty: jest.fn(() => { container.children.length = 0; }),
      appendChild: jest.fn((child: HTMLElement) => { container.children.push(child); }),
    } as unknown as HTMLElement & { children: HTMLElement[] };

    viewport.commit(container, renderRoot);

    expect(container.children[0]).toBe(previousItem);
    expect(nextItem.replaceWith).toHaveBeenCalledWith(previousItem);
  });

});
