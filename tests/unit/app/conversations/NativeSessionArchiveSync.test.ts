import { NativeSessionArchiveSync } from '@/app/conversations/NativeSessionArchiveSync';
import type { Conversation } from '@/core/types';

function conversation(id: string, providerId: 'codex' | 'claude', isArchived: boolean): Conversation {
  return { id, providerId, isArchived } as Conversation;
}

describe('NativeSessionArchiveSync', () => {
  it('batches by provider and mirrors the latest committed state', async () => {
    const conversations = new Map([
      ['one', conversation('one', 'codex', true)],
      ['two', conversation('two', 'codex', false)],
      ['three', conversation('three', 'claude', true)],
    ]);
    const codexArchive = { setSessionsArchived: jest.fn().mockResolvedValue(undefined) };
    const claudeArchive = { setSessionsArchived: jest.fn().mockResolvedValue(undefined) };
    const getSessionArchive = jest.fn(async (providerId) => (
      providerId === 'codex' ? codexArchive : claudeArchive
    ));
    const sync = new NativeSessionArchiveSync({
      getConversation: id => conversations.get(id) ?? null,
      getSessionArchive,
      onFailure: jest.fn(),
    });

    conversations.get('one')!.isArchived = false;
    await sync.sync(['one', 'two', 'three']);

    expect(getSessionArchive).toHaveBeenCalledTimes(2);
    expect(codexArchive.setSessionsArchived).toHaveBeenCalledWith([
      { conversation: conversations.get('one'), isArchived: false },
      { conversation: conversations.get('two'), isArchived: false },
    ]);
    expect(claudeArchive.setSessionsArchived).toHaveBeenCalledWith([
      { conversation: conversations.get('three'), isArchived: true },
    ]);
  });

  it('reports provider failures without rejecting or rolling back app state', async () => {
    const item = conversation('one', 'codex', true);
    const onFailure = jest.fn();
    const failure = new Error('Codex unavailable');
    const sync = new NativeSessionArchiveSync({
      getConversation: () => item,
      getSessionArchive: async () => ({
        setSessionsArchived: jest.fn().mockRejectedValue(failure),
      }),
      onFailure,
    });

    await expect(sync.sync(['one'])).resolves.toBeUndefined();

    expect(item.isArchived).toBe(true);
    expect(onFailure).toHaveBeenCalledWith('codex', failure);
  });
});
