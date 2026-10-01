import type { ConversationMeta } from '@/core/types';
import { InactiveSessionArchiver } from '@/features/chat/session-manager/InactiveSessionArchiver';

function conversation(
  id: string,
  lastActivityAt: number,
  updates: Partial<ConversationMeta> = {},
): ConversationMeta {
  return {
    id,
    lastActivityAt,
    isArchived: false,
    isPinned: false,
    title: id,
    createdAt: lastActivityAt,
    messageCount: 1,
    ...updates,
  } as ConversationMeta;
}

describe('InactiveSessionArchiver', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');

  it('archives only old, unpinned, closed active conversations after the configured age', async () => {
    const conversations = [
      conversation('old', now.getTime() - 15 * 86_400_000),
      conversation('recent', now.getTime() - 13 * 86_400_000),
      conversation('pinned', now.getTime() - 20 * 86_400_000, { isPinned: true }),
      conversation('archived', now.getTime() - 20 * 86_400_000, { isArchived: true }),
      conversation('open', now.getTime() - 20 * 86_400_000),
    ];
    const archiveConversationsIf = jest.fn(async (
      ids: readonly string[],
      isEligible: (candidate: ConversationMeta) => boolean,
    ) => ids.filter((id) => {
      const candidate = conversations.find(({ id: candidateId }) => candidateId === id);
      return candidate ? isEligible(candidate) : false;
    }).map((id) => id));
    const onArchived = jest.fn();
    const archiver = new InactiveSessionArchiver({
      getSettings: () => ({ sessionAutoArchiveAfter: '14d' }),
      getConversationList: () => conversations,
      getWorkspaceConversationIds: () => new Set(['open']),
      archiveConversationsIf,
      onArchived,
    }, () => now);

    await archiver.run();

    expect(archiveConversationsIf).toHaveBeenCalledWith(
      ['old'],
      expect.any(Function),
    );
    expect(onArchived).toHaveBeenCalledWith(1);
  });

  it('does nothing when auto-archive is disabled', async () => {
    const archiveConversationsIf = jest.fn();
    const onArchived = jest.fn();
    const archiver = new InactiveSessionArchiver({
      getSettings: () => ({ sessionAutoArchiveAfter: 'off' }),
      getConversationList: () => [conversation('old', 0)],
      getWorkspaceConversationIds: () => new Set(),
      archiveConversationsIf,
      onArchived,
    }, () => now);

    await archiver.run();

    expect(archiveConversationsIf).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it('rechecks pins and open tabs immediately before archiving', async () => {
    const candidate = conversation('candidate', now.getTime() - 20 * 86_400_000);
    let isOpen = false;
    let isPinned = false;
    const archiveConversationsIf = jest.fn(async (
      ids: readonly string[],
      isEligible: (current: ConversationMeta) => boolean,
    ) => {
      isPinned = true;
      isOpen = true;
      return ids.filter(() => isEligible({ ...candidate, isPinned }));
    });
    const onArchived = jest.fn();
    const archiver = new InactiveSessionArchiver({
      getSettings: () => ({ sessionAutoArchiveAfter: '7d' }),
      getConversationList: () => [candidate],
      getWorkspaceConversationIds: () => new Set(isOpen ? ['candidate'] : []),
      archiveConversationsIf,
      onArchived,
    }, () => now);

    await archiver.run();

    expect(archiveConversationsIf).toHaveBeenCalledTimes(1);
    expect(onArchived).not.toHaveBeenCalled();
  });
});
