import type { ConversationMeta } from '@/core/types';
import { projectHistory } from '@/features/chat/session-manager/HistoryProjection';

function createConversation(
  id: string,
  overrides: Partial<ConversationMeta> = {},
): ConversationMeta {
  return {
    id,
    providerId: 'claude',
    title: id,
    createdAt: 1,
    lastActivityAt: 1,
    messageCount: 0,
    preview: '',
    ...overrides,
  };
}

describe('HistoryProjection', () => {
  it('filters by session scope and all search terms before sorting', () => {
    const projection = projectHistory({
      conversations: [
        createConversation('archived-plan', {
          isArchived: true,
          title: 'Archived release plan',
          lastActivityAt: 30,
        }),
        createConversation('active-old', {
          title: 'Release notes',
          lastActivityAt: 10,
        }),
        createConversation('active-new', {
          title: 'Release plan',
          lastActivityAt: 20,
        }),
      ],
      sessionScope: 'active',
      searchQuery: 'release plan',
      organization: 'list',
      sort: 'last-updated',
      language: 'en',
    });

    expect(projection.sections[0]?.conversations.map(({ id }) => id)).toEqual(['active-new']);
    expect(projection.hasResults).toBe(true);
    expect(projection.searchTerms).toEqual(['release', 'plan']);
  });

  it('separates pinned linked-note sessions and counts collapsed groups', () => {
    const projection = projectHistory({
      conversations: [
        createConversation('pinned-note', {
          currentNote: 'Projects/Plan.md',
          lastActivityAt: 30,
        }),
        createConversation('pinned-session', {
          isPinned: true,
          lastActivityAt: 20,
        }),
        createConversation('regular', {
          currentNote: 'Projects/Other.md',
          lastActivityAt: 10,
        }),
      ],
      organization: 'linked-note',
      sort: 'last-updated',
      language: 'en',
      noteExists: () => true,
      pinnedLinkedNotePaths: new Set(['Projects/Plan.md']),
      showPinnedSection: true,
      collapsedGroupKeys: new Set(['note:Projects/Other.md']),
      pageSize: 1,
    });

    expect(projection.pinnedNoteSections.map(({ notePath }) => notePath)).toEqual(['Projects/Plan.md']);
    expect(projection.sortedPinnedConversations.map(({ id }) => id)).toEqual(['pinned-session']);
    expect(projection.sections.map(({ notePath }) => notePath)).toEqual(['Projects/Other.md']);
    expect(projection.visibleConversationTotal).toBe(2);
    expect(projection.visibleCount).toBe(1);
  });

  it('keeps archived filtering and pagination state independent', () => {
    const projection = projectHistory({
      conversations: [
        createConversation('archived', { isArchived: true, lastActivityAt: 30 }),
        createConversation('active', { lastActivityAt: 20 }),
      ],
      organization: 'list',
      sort: 'last-updated',
      language: 'en',
      sessionScope: 'archived',
      previousVisibleCount: 50,
      visibleCount: 75,
      pageSize: 20,
    });

    expect(projection.sections[0]?.conversations.map(({ id }) => id)).toEqual(['archived']);
    expect(projection.visibleCount).toBe(75);
    expect(projection.pageSize).toBe(20);
    expect(projection.showSessionSections).toBe(false);
  });
});
