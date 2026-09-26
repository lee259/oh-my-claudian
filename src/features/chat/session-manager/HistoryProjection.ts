import type { ConversationMeta } from '../../../core/types';

export interface HistoryProjectionOptions {
  conversations: readonly ConversationMeta[];
  sessionScope?: 'active' | 'archived';
  searchQuery?: string;
  previousVisibleCount?: number;
  visibleCount?: number;
  pageSize?: number;
}

export interface HistoryProjection {
  filteredConversations: ConversationMeta[];
  visibleCount: number;
  pageSize: number;
  visibleConversationTotal: number;
  searchTerms: string[];
  hasResults: boolean;
}

export function projectHistory(options: HistoryProjectionOptions): HistoryProjection {
  const scopedConversations = options.sessionScope === 'archived'
    ? options.conversations.filter(conversation => conversation.isArchived)
    : options.sessionScope === 'active'
      ? options.conversations.filter(conversation => !conversation.isArchived)
      : [...options.conversations];
  const searchTerms = (options.searchQuery ?? '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const filteredConversations = scopedConversations
    .filter((conversation) => {
      if (searchTerms.length === 0) return true;
      const searchableText = [conversation.title, conversation.currentNote ?? '']
        .join('\n')
        .toLocaleLowerCase();
      return searchTerms.every(term => searchableText.includes(term));
    })
    .sort((left, right) => (
      right.lastActivityAt - left.lastActivityAt
      || left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true })
      || left.id.localeCompare(right.id)
    ));
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const visibleCount = Math.max(
    pageSize,
    options.visibleCount ?? options.previousVisibleCount ?? 0,
  );

  return {
    filteredConversations,
    visibleCount,
    pageSize,
    visibleConversationTotal: filteredConversations.length,
    searchTerms,
    hasResults: filteredConversations.length > 0,
  };
}
