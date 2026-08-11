import type {
  ConversationMeta,
  SessionManagerOrganization,
  SessionManagerSort,
} from '../../../core/types';
import { organizeSessionList, type SessionListSection } from './SessionListOrganizer';

export interface HistoryProjectionOptions {
  conversations: readonly ConversationMeta[];
  organization: SessionManagerOrganization;
  sort: SessionManagerSort;
  language: string;
  sessionScope?: 'active' | 'archived';
  searchQuery?: string;
  noteExists?: (notePath: string) => boolean;
  pinnedLinkedNotePaths?: ReadonlySet<string>;
  showPinnedSection?: boolean;
  showArchivedSection?: boolean;
  collapsedGroupKeys?: ReadonlySet<string>;
  previousVisibleCount?: number;
  visibleCount?: number;
  pageSize?: number;
}

export interface HistoryProjection {
  sections: SessionListSection[];
  pinnedNoteSections: SessionListSection[];
  sortedPinnedConversations: ConversationMeta[];
  conversationsByLinkedNote: ReadonlyMap<string, ConversationMeta[]>;
  filteredConversations: ConversationMeta[];
  pinnedConversations: ConversationMeta[];
  visibleCount: number;
  pageSize: number;
  visibleConversationTotal: number;
  showSessionSections: boolean;
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
  const filteredConversations = searchTerms.length === 0
    ? scopedConversations
    : scopedConversations.filter((conversation) => {
        const searchableText = [conversation.title, conversation.currentNote ?? '']
          .join('\n')
          .toLocaleLowerCase();
        return searchTerms.every(term => searchableText.includes(term));
      });
  const conversationsByLinkedNote = new Map<string, ConversationMeta[]>();
  for (const conversation of scopedConversations) {
    if (!conversation.currentNote) continue;
    const noteConversations = conversationsByLinkedNote.get(conversation.currentNote) ?? [];
    noteConversations.push(conversation);
    conversationsByLinkedNote.set(conversation.currentNote, noteConversations);
  }
  const showPinnedSection = options.showPinnedSection === true;
  const pinnedLinkedNotePaths = options.organization === 'linked-note'
    && showPinnedSection
    && options.sessionScope !== 'archived'
    ? options.pinnedLinkedNotePaths ?? new Set<string>()
    : new Set<string>();
  const isInPinnedNoteGroup = (conversation: ConversationMeta): boolean => (
    !!conversation.currentNote
    && pinnedLinkedNotePaths.has(conversation.currentNote)
  );
  const pinnedNoteConversations = filteredConversations.filter(isInPinnedNoteGroup);
  const pinnedConversations = showPinnedSection
    ? filteredConversations.filter(conversation => (
        conversation.isPinned && !isInPinnedNoteGroup(conversation)
      ))
    : [];
  const sessionConversations = showPinnedSection
    ? filteredConversations.filter(conversation => (
        !conversation.isPinned && !isInPinnedNoteGroup(conversation)
      ))
    : filteredConversations;
  const pinnedPathsWithMatchingSessions = new Set(
    pinnedNoteConversations.flatMap(conversation => (
      conversation.currentNote ? [conversation.currentNote] : []
    )),
  );
  const visiblePinnedNotePaths = [...pinnedLinkedNotePaths].filter((notePath) => (
    searchTerms.length === 0
    || pinnedPathsWithMatchingSessions.has(notePath)
    || searchTerms.every(term => notePath.toLocaleLowerCase().includes(term))
  ));
  const pinnedNoteSections = organizeSessionList(pinnedNoteConversations, {
    organization: 'linked-note',
    sort: options.sort,
    language: options.language,
    includeNotePaths: visiblePinnedNotePaths,
    noteExists: options.noteExists,
  }).filter(section => section.notePath !== undefined);
  const sortedPinnedConversations = organizeSessionList(pinnedConversations, {
    organization: 'list',
    sort: options.sort,
    language: options.language,
  })[0]?.conversations ?? [];
  const sections = organizeSessionList(sessionConversations, {
    organization: options.organization,
    sort: options.sort,
    language: options.language,
    noteExists: options.noteExists,
  });
  const collapsedGroupKeys = options.collapsedGroupKeys ?? new Set<string>();
  const visiblePinnedNoteConversationTotal = pinnedNoteSections.reduce((total, section) => (
    collapsedGroupKeys.has(section.key) ? total : total + section.conversations.length
  ), 0);
  const visibleSessionConversationTotal = options.organization === 'linked-note'
    ? sections.reduce((total, section) => (
        collapsedGroupKeys.has(section.key) ? total : total + section.conversations.length
      ), 0)
    : sessionConversations.length;
  const visibleConversationTotal = visiblePinnedNoteConversationTotal
    + pinnedConversations.length
    + visibleSessionConversationTotal;
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const visibleCount = Math.max(
    pageSize,
    options.visibleCount ?? options.previousVisibleCount ?? 0,
  );
  const showSessionSections = options.showPinnedSection === true || options.showArchivedSection === true;

  return {
    sections,
    pinnedNoteSections,
    sortedPinnedConversations,
    conversationsByLinkedNote,
    filteredConversations,
    pinnedConversations,
    visibleCount,
    pageSize,
    visibleConversationTotal,
    showSessionSections,
    searchTerms,
    hasResults: filteredConversations.length > 0 || pinnedNoteSections.length > 0,
  };
}
