import { resolveTabCloseFollowUp } from '@/features/chat/tabs/TabCloseCoordinator';

describe('resolveTabCloseFollowUp', () => {
  const base = {
    activeTabId: 'tab-2',
    closedTabId: 'tab-2',
    tabIdsBeforeClose: ['tab-1', 'tab-2', 'tab-3'],
  } as const;

  it('selects the previous tab when closing a non-first active tab', () => {
    expect(resolveTabCloseFollowUp({
      ...base,
      remainingTabIds: new Set(['tab-1', 'tab-3']),
    })).toEqual({ kind: 'switch', tabId: 'tab-1' });
  });

  it('selects the next tab when closing the first active tab', () => {
    expect(resolveTabCloseFollowUp({
      activeTabId: 'tab-1',
      closedTabId: 'tab-1',
      tabIdsBeforeClose: ['tab-1', 'tab-2'],
      remainingTabIds: new Set(['tab-2']),
    })).toEqual({ kind: 'switch', tabId: 'tab-2' });
  });

  it('requests a replacement when the final active tab is closed', () => {
    expect(resolveTabCloseFollowUp({
      activeTabId: 'tab-1',
      closedTabId: 'tab-1',
      tabIdsBeforeClose: ['tab-1'],
      remainingTabIds: new Set(),
    })).toEqual({ kind: 'create' });
  });

  it('does not navigate when closing an inactive tab', () => {
    expect(resolveTabCloseFollowUp({
      ...base,
      closedTabId: 'tab-1',
      remainingTabIds: new Set(['tab-2', 'tab-3']),
    })).toEqual({ kind: 'none' });
  });
});
