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
