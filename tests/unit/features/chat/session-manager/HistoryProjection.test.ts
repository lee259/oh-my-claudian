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
    });

    expect(projection.filteredConversations.map(({ id }) => id)).toEqual(['active-new']);
    expect(projection.hasResults).toBe(true);
    expect(projection.searchTerms).toEqual(['release', 'plan']);
  });

  it('searches linked-note paths and preserves activity ordering', () => {
    const projection = projectHistory({
      conversations: [
        createConversation('older', {
          currentNote: 'Projects/Plan.md',
          lastActivityAt: 10,
        }),
        createConversation('newer', {
          currentNote: 'Projects/Plan.md',
          lastActivityAt: 30,
        }),
        createConversation('other', {
          currentNote: 'Notes/Other.md',
          lastActivityAt: 40,
        }),
      ],
      searchQuery: 'projects plan',
    });

    expect(projection.filteredConversations.map(({ id }) => id)).toEqual(['newer', 'older']);
    expect(projection.visibleConversationTotal).toBe(2);
  });

  it('keeps archived scope and pagination state', () => {
    const projection = projectHistory({
      conversations: [
        createConversation('archived', { isArchived: true, lastActivityAt: 30 }),
        createConversation('active', { lastActivityAt: 20 }),
      ],
      sessionScope: 'archived',
      previousVisibleCount: 50,
      visibleCount: 75,
      pageSize: 20,
    });

    expect(projection.filteredConversations.map(({ id }) => id)).toEqual(['archived']);
    expect(projection.visibleCount).toBe(75);
    expect(projection.pageSize).toBe(20);
  });
});
