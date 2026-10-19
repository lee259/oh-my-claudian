import '@/providers';

import { createMockVaultFileAdapter } from '@test/helpers/MockVaultFileAdapter';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import { createConversationMetadataShell } from '@/app/conversations/SessionMetadataCoordinator';
import { ConversationPersistenceStore } from '@/core/bootstrap/ConversationPersistenceStore';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ChatMessage, Conversation } from '@/core/types';

const user = (id: string, content: string): ChatMessage => ({
  id, role: 'user', content, timestamp: 1, userMessageId: id,
});
const assistant = (id: string, modelName?: string): ChatMessage => ({
  id, role: 'assistant', content: 'Answer', timestamp: 2, assistantMessageId: id,
  ...(modelName ? { modelName } : {}),
});

function createHarness() {
  const files = new Map<string, string>();
  const adapter = createMockVaultFileAdapter();
  adapter.exists.mockImplementation(async path => files.has(path));
  adapter.write.mockImplementation(async (path, content) => { files.set(path, content); });
  adapter.read.mockImplementation(async path => files.get(path)!);
  const createRepository = () => new ConversationRepository({
    persistence: new ConversationPersistenceStore(adapter),
    getSettings: () => ({}),
    getVaultPath: () => '/vault',
    onConversationDeleted: async () => {},
  });
  const restart = async (messages: ChatMessage[]) => {
    const storage = new ConversationPersistenceStore(adapter);
    const metadata = await storage.metadataReader.loadMetadata('conversation-1');
    const conversation = createConversationMetadataShell(metadata!);
    const repository = createRepository();
    repository.replaceAll([conversation]);
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory: async (target: Conversation) => { target.messages = messages; },
    } as any);
    await repository.ensureHydrated(conversation.id);
    return { repository, conversation };
  };
  return { files, adapter, createRepository, restart };
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conversation-1', providerId: 'claude', title: 'Models', createdAt: 1,
    lastActivityAt: 2, sessionId: 'native-session', selectedModel: 'sonnet', messages,
  };
}

describe('ConversationRepository historical turn models', () => {
  afterEach(() => jest.restoreAllMocks());

  it('retains each turn model through persistence and a fresh repository hydration', async () => {
    const harness = createHarness();
    const live = conversation([
      user('user-1', 'First'), assistant('assistant-1', 'GPT-6 Luna'),
      user('user-2', 'Second'), assistant('assistant-2', 'Sonnet'),
    ]);
    const repository = harness.createRepository();
    repository.replaceAll([live]);
    await repository.persistConversations([live]);

    const restored = await harness.restart([
      user('user-1', 'First'), assistant('assistant-1'),
      user('user-2', 'Second'), assistant('assistant-2'),
    ]);

    expect(restored.conversation.messages.filter(message => message.role === 'assistant')
      .map(message => message.modelName)).toEqual(['GPT-6 Luna', 'Sonnet']);
  });

  it('preserves labels on a metadata-only save before history is opened', async () => {
    const harness = createHarness();
    const repository = harness.createRepository();
    const live = conversation([user('user-1', 'First'), assistant('assistant-1', 'GPT-6 Luna')]);
    repository.replaceAll([live]);
    await repository.persistConversations([live]);
    const storage = new ConversationPersistenceStore(harness.adapter);
    const metadata = await storage.metadataReader.loadMetadata(live.id);
    const shell = createConversationMetadataShell(metadata!);
    const fresh = harness.createRepository();
    fresh.replaceAll([shell]);
    shell.isPinned = true;
    await fresh.persistConversations([shell]);
    const restored = await harness.restart([user('user-1', 'First'), assistant('assistant-1')]);
    expect(restored.conversation.messages[1].modelName).toBe('GPT-6 Luna');
  });

  it('correlates by input ordinal and digest when native message IDs are unavailable', async () => {
    const harness = createHarness();
    const firstUser = user('user-1', 'First');
    delete firstUser.userMessageId;
    const firstAssistant = assistant('assistant-1', 'GPT-6 Luna');
    delete firstAssistant.assistantMessageId;
    const live = conversation([firstUser, firstAssistant]);
    const repository = harness.createRepository();
    repository.replaceAll([live]);
    await repository.persistConversations([live]);
    const restored = await harness.restart([
      { ...firstUser, id: 'history-user' },
      { ...assistant('history-assistant'), assistantMessageId: undefined },
    ]);
    expect(restored.conversation.messages[1].modelName).toBe('GPT-6 Luna');
    await restored.repository.persistConversations([restored.conversation]);
    const again = await harness.restart([
      { ...firstUser, id: 'history-user-2' },
      { ...assistant('history-assistant-2'), assistantMessageId: undefined },
    ]);
    expect(again.conversation.messages[1].modelName).toBe('GPT-6 Luna');
  });

  it('does not mislabel a replacement native branch or a changed input without IDs', async () => {
    const harness = createHarness();
    const live = conversation([
      user('user-1', 'First'), assistant('assistant-1', 'GPT-6 Luna'),
    ]);
    const repository = harness.createRepository();
    repository.replaceAll([live]);
    await repository.persistConversations([live]);
    const replaced = await harness.restart([user('replacement-user', 'First'), assistant('replacement-answer')]);
    expect(replaced.conversation.messages[1].modelName).toBeUndefined();
    const changed = await harness.restart([
      { ...user('user-1', 'Different input'), userMessageId: undefined },
      { ...assistant('assistant-1'), assistantMessageId: undefined },
    ]);
    expect(changed.conversation.messages[1].modelName).toBeUndefined();
  });

  it('does not invent historical labels from the current selected model for legacy sessions', async () => {
    const harness = createHarness();
    const live = conversation([user('user-1', 'First'), assistant('assistant-1')]);
    const repository = harness.createRepository();
    repository.replaceAll([live]);
    await repository.persistConversations([live]);
    const restored = await harness.restart([user('user-1', 'First'), assistant('assistant-1')]);
    expect(restored.conversation.messages[1].modelName).toBeUndefined();
  });

  it('drops models from removed turns when saving a truncated transcript', async () => {
    const harness = createHarness();
    const live = conversation([
      user('user-1', 'First'), assistant('assistant-1', 'GPT-6 Luna'),
      user('user-2', 'Second'), assistant('assistant-2', 'Sonnet'),
    ]);
    const repository = harness.createRepository();
    repository.replaceAll([live]);
    await repository.persistConversations([live]);
    const restored = await harness.restart([
      user('user-1', 'First'), assistant('assistant-1'),
      user('user-2', 'Second'), assistant('assistant-2'),
    ]);
    restored.conversation.messages.splice(2);
    await restored.repository.persistConversations([restored.conversation]);
    const metadata = await new ConversationPersistenceStore(harness.adapter)
      .metadataReader.loadMetadata(live.id);
    expect(metadata!.turnModels).toHaveLength(1);
    expect(metadata!.turnModels![0].modelName).toBe('GPT-6 Luna');
  });

  it('ignores malformed model records while retaining valid historical labels', async () => {
    const harness = createHarness();
    const storage = new ConversationPersistenceStore(harness.adapter);
    await storage.saveMetadata({
      id: 'conversation-1', title: 'Models', createdAt: 1, lastActivityAt: 2,
      selectedModel: 'sonnet', sessionId: 'native-session',
      turnModels: [
        null, { modelName: 123, userTurnOrdinal: 1 },
        { modelName: 'Bad', userTurnOrdinal: -1 },
        { modelName: 'GPT-6 Luna', userTurnOrdinal: 1, assistantMessageId: 'assistant-1' },
      ] as any,
    });
    const restored = await harness.restart([user('user-1', 'First'), assistant('assistant-1')]);
    expect(restored.conversation.messages[1].modelName).toBe('GPT-6 Luna');
  });


  it('retains live model labels when resetting the provider binding during a save', async () => {
    const harness = createHarness();
    const live = conversation([user('user-1', 'First'), assistant('assistant-1', 'GPT-6 Luna')]);
    const repository = harness.createRepository();
    repository.replaceAll([live]);
    await repository.update(live.id, { messages: live.messages, sessionId: null, providerState: undefined });
    const stored = await new ConversationPersistenceStore(harness.adapter).metadataReader.loadMetadata(live.id);
    expect(stored!.turnModels?.[0].modelName).toBe('GPT-6 Luna');
  });

});
