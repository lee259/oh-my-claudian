import type { TabId } from './types';

export type TabCloseFollowUp =
  | { kind: 'none' }
  | { kind: 'switch'; tabId: TabId }
  | { kind: 'create' };

export type TabCloseFollowUpOptions = {
  activeTabId: TabId | null;
  closedTabId: TabId;
  tabIdsBeforeClose: readonly TabId[];
  remainingTabIds: ReadonlySet<TabId>;
};

/**
 * Resolves the navigation consequence of closing a tab.
 *
 * The caller retains ownership of tab storage and performs the follow-up.
 * This policy only encodes the user-visible rule: closing an active tab
 * selects the previous tab, except when closing the first tab, where it
 * selects the next one; closing the final tab creates a blank replacement.
 */
export function resolveTabCloseFollowUp(
  options: TabCloseFollowUpOptions,
): TabCloseFollowUp {
  const {
    activeTabId,
    closedTabId,
    tabIdsBeforeClose,
    remainingTabIds,
  } = options;

  if (activeTabId !== closedTabId) return { kind: 'none' };
  if (remainingTabIds.size === 0) return { kind: 'create' };

  const closingIndex = tabIdsBeforeClose.indexOf(closedTabId);
  if (closingIndex < 0) return { kind: 'none' };

  const candidateTabId = closingIndex === 0
    ? tabIdsBeforeClose[1]
    : tabIdsBeforeClose[closingIndex - 1];

  return candidateTabId && remainingTabIds.has(candidateTabId)
    ? { kind: 'switch', tabId: candidateTabId }
    : { kind: 'none' };
}
