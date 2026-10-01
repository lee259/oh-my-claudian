import type { ConversationMeta, SessionAutoArchiveAfter } from '../../../core/types';

const DAY_MS = 86_400_000;
const AUTO_ARCHIVE_AFTER_DAYS: Record<SessionAutoArchiveAfter, number | null> = {
  off: null,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

export interface InactiveSessionArchiverHost {
  getSettings(): { sessionAutoArchiveAfter: SessionAutoArchiveAfter };
  getConversationList(): readonly ConversationMeta[];
  getWorkspaceConversationIds(): ReadonlySet<string>;
  archiveConversationsIf(
    ids: readonly string[],
    isEligible: (conversation: Readonly<Pick<ConversationMeta, 'id' | 'isArchived' | 'isPinned' | 'lastActivityAt'>>) => boolean,
    ): Promise<readonly string[]>;
  onArchived(count: number): void;
}

/** Archives inactive, unpinned sessions that are not open in any chat view. */
export class InactiveSessionArchiver {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: InactiveSessionArchiverHost,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Serialize triggers so each pass rechecks the latest conversations before writing. */
  run(): Promise<void> {
    const next = this.tail.then(() => this.archiveInactive());
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async archiveInactive(): Promise<void> {
    const days = AUTO_ARCHIVE_AFTER_DAYS[this.host.getSettings().sessionAutoArchiveAfter];
    if (days === null) return;

    const cutoff = this.now().getTime() - days * DAY_MS;
    const isEligible = (
      conversation: Readonly<Pick<ConversationMeta, 'id' | 'isArchived' | 'isPinned' | 'lastActivityAt'>>,
      openIds: ReadonlySet<string>,
    ): boolean => (
      conversation.isArchived !== true
      && conversation.isPinned !== true
      && conversation.lastActivityAt < cutoff
      && !openIds.has(conversation.id)
    );
    const initialOpenIds = this.host.getWorkspaceConversationIds();
    const candidateIds = this.host.getConversationList()
      .filter(conversation => isEligible(conversation, initialOpenIds))
      .map(conversation => conversation.id);
    if (candidateIds.length === 0) return;

    const archivedIds = await this.host.archiveConversationsIf(
      candidateIds,
      conversation => isEligible(conversation, this.host.getWorkspaceConversationIds()),
    );
    if (archivedIds.length > 0) this.host.onArchived(archivedIds.length);
  }
}
