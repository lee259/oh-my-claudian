import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { Conversation } from '@/core/types';
import { ConversationRuntime } from '@/features/chat/sessions/ConversationRuntime';
import { rewriteVaultPathAfterRename } from '@/utils/path';

function createState() {
  return {
    conversationId: null,
    draftModel: null,
    id: 'tab-1',
    lifecycleState: 'cold' as const,
    providerId: 'claude' as const,
  };
}

describe('ConversationRuntime', () => {
  it('keeps retained manual context in sync when a note or its parent is renamed', () => {
    const runtime = new ConversationRuntime(createState());
    runtime.context.capture({ currentNote: 'old/note.md', externalContextPaths: ['/outside'], enabledMcpServers: ['server'] });
    runtime.retainedFileContext = {
      files: ['old/note.md', 'old/other.md', 'older/keep.md'],
      manualFiles: ['old/note.md', 'older/keep.md'],
      currentNoteSent: true, sessionStarted: true,
    };
    const rewrite = (value: string) => rewriteVaultPathAfterRename(value, 'old', 'new', true) ?? value;
    runtime.rewriteLinkedVaultPaths(rewrite);
    expect(runtime.context.snapshot).toEqual({ currentNote: 'new/note.md', externalContextPaths: ['/outside'], enabledMcpServers: ['server'] });
    expect(runtime.retainedFileContext).toEqual({
      files: ['new/note.md', 'new/other.md', 'older/keep.md'],
      manualFiles: ['new/note.md', 'older/keep.md'],
      currentNoteSent: true, sessionStarted: true,
    });
  });

  it('reloads changed native history only after cooling the old execution owner', async () => {
    const runtime = new ConversationRuntime({ ...createState(), conversationId: 'c1', providerId: 'codex' });
    runtime.hydrationState = 'ready';
    runtime.state.messages = [{ id: 'old', role: 'user', content: 'old', timestamp: 1 }];
    let revision = 'first';
    const history = jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      readNativeHistoryRevision: jest.fn(),
    } as any);
    const coordinator = { state: 'idle', canCool: jest.fn(() => true), cool: jest.fn(async () => undefined) };
    runtime.setExecutionCoordinator(coordinator as any);
    const host = {
      readNativeHistoryRevision: jest.fn(async () => revision),
      reloadNativeHistory: jest.fn(async () => ({ id: 'c1', providerId: 'codex', messages: [
        { id: 'new', role: 'user', content: 'external', timestamp: 2 },
      ] })),
    } as any;
    expect(await runtime.ensureNativeHistoryCurrent(host)).toBe(true);
    expect(coordinator.cool).toHaveBeenCalledTimes(1);
    expect(runtime.state.messages[0].content).toBe('external');
    revision = 'second';
    expect(await runtime.ensureNativeHistoryCurrent(host)).toBe(true);
    expect(coordinator.cool).toHaveBeenCalledTimes(2);
    expect(host.reloadNativeHistory).toHaveBeenCalledWith('c1');
    expect(runtime.state.messages[0].content).toBe('external');
    history.mockRestore();
  });

  it('refuses a changed native history while background work owns the execution', async () => {
    const runtime = new ConversationRuntime({ ...createState(), conversationId: 'c1', providerId: 'codex' });
    runtime.hydrationState = 'ready';
    let revision = 'first';
    const history = jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      readNativeHistoryRevision: jest.fn(),
    } as any);
    const host = {
      readNativeHistoryRevision: jest.fn(async () => revision),
      reloadNativeHistory: jest.fn(async () => ({ id: 'c1', providerId: 'codex', messages: [] })),
    } as any;
    expect(await runtime.ensureNativeHistoryCurrent(host)).toBe(true);
    host.reloadNativeHistory.mockClear();

    let finish!: () => void;
    runtime.enqueueBackgroundWork(() => new Promise<void>(resolve => { finish = resolve; }));
    revision = 'second';
    expect(await runtime.ensureNativeHistoryCurrent(host)).toBe(false);
    expect(host.reloadNativeHistory).not.toHaveBeenCalled();

    finish();
    await runtime.awaitBackgroundWork();
    history.mockRestore();
  });

  it('reports queued background work until it settles', async () => {
    let release!: () => void;
    const onWorkChanged = jest.fn();
    const session = new ConversationRuntime(createState(), onWorkChanged);
    const pending = session.enqueueBackgroundWork(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    expect(session.hasBackgroundWork).toBe(true);
    expect(onWorkChanged).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();
    release();
    await pending;
    await Promise.resolve();

    expect(session.hasBackgroundWork).toBe(false);
    expect(onWorkChanged).toHaveBeenCalledTimes(2);
  });
});

it('publishes model changes after presentation callbacks detach and fences old callback cleanup', () => {
  const runtime = new ConversationRuntime(createState());
  const previous = jest.fn();
  const current = jest.fn();
  const changes = jest.fn();
  runtime.subscribe(changes);
  const detach = runtime.bindPresentationCallbacks('pane', { onStreamingStateChanged: previous });
  runtime.state.isStreaming = true;
  detach();
  runtime.state.isStreaming = false;
  runtime.bindPresentationCallbacks('pane', { onStreamingStateChanged: current });
  detach();
  runtime.state.isStreaming = true;
  expect(previous.mock.calls).toEqual([[true]]);
  expect(current.mock.calls).toEqual([[true]]);
  expect(changes).toHaveBeenCalledTimes(3);
});

it('retains review attention after detach without keeping a presentation callback alive', () => {
  const runtime = new ConversationRuntime(createState());
  let revision = 1;
  runtime.presentation = { epoch: Symbol('pane'), isActive: () => false, getActivationRevision: () => revision } as any;
  const stale = runtime.captureReviewableSettlement('completed');
  revision++;
  stale();
  expect(runtime.state.attention).toBeNull();
  const detached = runtime.captureReviewableSettlement('completed');
  runtime.presentation = null;
  detached();
  expect(runtime.state.attention).toMatchObject({ kind: 'review', outcome: 'completed' });
});


describe('incomplete history retry', () => {
  afterEach(() => jest.restoreAllMocks());
  const conversation: Conversation = { id: 'conversation', providerId: 'claude', title: 'History',
    createdAt: 1, lastActivityAt: 1, sessionId: null, messages: [] };

  function runtimeWithDiagnostic() {
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      needsConversationHistoryHydration: (projection: Conversation) => projection.messages[0]?.content === 'Unavailable',
    } as any);
    const runtime = new ConversationRuntime({ ...createState(), conversationId: conversation.id });
    runtime.hydrationState = 'ready';
    runtime.state.messages = [{ id: 'diagnostic', role: 'assistant', content: 'Unavailable', timestamp: 1 }];
    runtime.composer.value = 'Keep my draft';
    return runtime;
  }

  it('refreshes an incomplete idle projection without replacing the retained composer', async () => {
    const runtime = runtimeWithDiagnostic();
    const load = jest.fn(async () => ({ ...conversation,
      messages: [{ id: 'recovered', role: 'user' as const, content: 'Recovered', timestamp: 2 }] }));
    await runtime.retryIncompleteHistory(conversation, load);
    expect(runtime.state.messages[0].content).toBe('Recovered');
    expect(runtime.composer.value).toBe('Keep my draft');
    await runtime.retryIncompleteHistory(conversation, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not hydrate a running runtime or overwrite work started during a retry', async () => {
    const runtime = runtimeWithDiagnostic();
    const load = jest.fn(async () => conversation);
    runtime.state.isStreaming = true;
    await runtime.retryIncompleteHistory(conversation, load);
    expect(load).not.toHaveBeenCalled();
    runtime.state.isStreaming = false;
    let resolve!: (value: Conversation) => void;
    const pending = runtime.retryIncompleteHistory(conversation, () => new Promise(next => { resolve = next; }));
    runtime.state.messages = [{ id: 'new', role: 'user', content: 'New work', timestamp: 3 }];
    resolve({ ...conversation, messages: [] });
    await pending;
    expect(runtime.state.messages[0].content).toBe('New work');
  });
});
