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
