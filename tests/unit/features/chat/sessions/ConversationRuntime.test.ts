import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { Conversation } from '@/core/types';
import { ConversationRuntime } from '@/features/chat/sessions/ConversationRuntime';

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
