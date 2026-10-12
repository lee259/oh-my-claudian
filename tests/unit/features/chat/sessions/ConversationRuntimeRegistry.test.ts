import { ConversationRuntime } from '@/features/chat/sessions/ConversationRuntime';
import { ConversationRuntimeRegistry } from '@/features/chat/sessions/ConversationRuntimeRegistry';

it('reserves a conversation before hydration so concurrent panes share one runtime', async () => {
  const registry = new ConversationRuntimeRegistry();
  let hydrate!: () => void;
  const create = jest.fn(async () => {
    await new Promise<void>(resolve => { hydrate = resolve; });
    return new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'cold', draftModel: null });
  });
  const first = registry.getOrCreate('conversation-1', create);
  const second = registry.getOrCreate('conversation-1', create);
  await Promise.resolve();
  expect(create).toHaveBeenCalledTimes(1);
  hydrate();
  const runtime = await first;
  expect(await second).toBe(runtime);
  expect(registry.get('conversation-1')).toBe(runtime);
});

it('retains a detached runtime and fences cleanup from its previous presentation', async () => {
  const registry = new ConversationRuntimeRegistry();
  const runtime = await registry.getOrCreate('conversation-1', async () => new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'cold', draftModel: null }));
  const first = registry.attach(runtime.id, 'pane-1');
  expect(first.kind).toBe('attached');
  const duplicate = registry.attach(runtime.id, 'pane-2');
  expect(duplicate).toEqual({ kind: 'existing', handle: first.handle });
  registry.detach(first.handle);
  const current = registry.attach(runtime.id, 'pane-2');
  expect(registry.detach(first.handle)).toBe(false);
  expect(registry.getAttachment(runtime.id)).toBe(current.handle);
  expect(registry.get('conversation-1')).toBe(runtime);
});

it('fences admission synchronously on unload and disposes a runtime created by an earlier reservation', async () => {
  const disposed = jest.fn(async () => undefined);
  const registry = new ConversationRuntimeRegistry(disposed);
  let hydrate!: () => void;
  const runtime = new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'cold', draftModel: null });
  const creation = registry.getOrCreate('conversation-1', async () => {
    await new Promise<void>(resolve => { hydrate = resolve; });
    return runtime;
  });
  const rejected = creation.catch(error => error);
  await Promise.resolve();
  const unloading = registry.dispose();
  await expect(registry.getOrCreate('other', async () => runtime)).rejects.toThrow('closed');
  hydrate();
  await unloading;
  await expect(rejected).resolves.toBeInstanceOf(Error);
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(disposed).toHaveBeenCalledWith(runtime);
  expect(registry.get('conversation-1')).toBeNull();
});

it('reports cleanup failure from a runtime that finishes creating during unload', async () => {
  const registry = new ConversationRuntimeRegistry(async () => { throw new Error('Could not drain runtime'); });
  let hydrate!: () => void;
  const creation = registry.getOrCreate('conversation-1', async () => {
    await new Promise<void>(resolve => { hydrate = resolve; });
    return new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'cold', draftModel: null });
  });
  const rejected = creation.catch(error => error);
  await Promise.resolve();
  const unloading = registry.dispose();
  hydrate();
  await expect(unloading).rejects.toThrow('cleanup failed');
  await expect(rejected).resolves.toBeInstanceOf(Error);
});

it('finds adopted drafts by their current conversation binding and releases only the adopted runtime', () => {
  const registry = new ConversationRuntimeRegistry();
  const runtime = new ConversationRuntime({ id: 'draft-1', conversationId: null, providerId: 'claude', lifecycleState: 'cold', draftModel: null });
  const release = registry.register(runtime);
  runtime.state.currentConversationId = 'created-conversation';
  expect(registry.get('created-conversation')).toBe(runtime);
  runtime.state.currentConversationId = 'replacement-conversation';
  expect(registry.get('created-conversation')).toBeNull();
  expect(registry.get('replacement-conversation')).toBe(runtime);
  release();
  expect(registry.getAll()).toEqual([]);
});

it('reports and stops work without any presentation, waiting for turn persistence and preserving siblings', async () => {
  const registry = new ConversationRuntimeRegistry();
  const runtime = new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'warm', draftModel: null });
  const sibling = new ConversationRuntime({ id: 'runtime-2', conversationId: 'conversation-2', providerId: 'claude', lifecycleState: 'warm', draftModel: null });
  registry.register(runtime);
  registry.register(sibling);
  runtime.state.isStreaming = true;
  sibling.state.isStreaming = true;
  let finish!: () => void;
  runtime.activeTurn = new Promise<void>(resolve => { finish = resolve; });
  const cancel = jest.fn();
  runtime.controllers.inputController = { cancelStreaming: cancel } as any;
  let stopped = false;
  const pending = registry.stop('conversation-1').then(() => { stopped = true; });
  await Promise.resolve();
  expect(registry.isRunning('conversation-1')).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stopped).toBe(false);
  runtime.state.isStreaming = false;
  runtime.activeTurn = null;
  finish();
  await pending;
  expect(registry.isRunning('conversation-1')).toBe(false);
  expect(registry.isRunning('conversation-2')).toBe(true);
});

it('publishes work changes after presentation callbacks detach without refreshing on every text delta', () => {
  const changed = jest.fn();
  const registry = new ConversationRuntimeRegistry(undefined, changed);
  const runtime = new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'warm', draftModel: null });
  const release = registry.register(runtime);
  const detach = runtime.bindPresentationCallbacks('pane', {});
  detach();
  changed.mockClear();
  runtime.state.isStreaming = true;
  runtime.state.messages = [];
  runtime.state.messages = [];
  expect(changed).toHaveBeenCalledTimes(1);
  release();
  changed.mockClear();
  runtime.state.isStreaming = false;
  expect(changed).not.toHaveBeenCalled();
});

it('still stops native background work when the foreground turn fails', async () => {
  const registry = new ConversationRuntimeRegistry();
  const runtime = new ConversationRuntime({ id: 'runtime-1', conversationId: 'conversation-1', providerId: 'claude', lifecycleState: 'warm', draftModel: null });
  const stopSessionWork = jest.fn(async () => undefined);
  runtime.setExecutionCoordinator({ cancel: jest.fn(), stopSessionWork } as any);
  runtime.activeTurn = Promise.reject(new Error('Turn persistence failed'));
  registry.register(runtime);
  await expect(registry.stop('conversation-1')).rejects.toThrow('Turn persistence failed');
  expect(stopSessionWork).toHaveBeenCalledTimes(1);
});
