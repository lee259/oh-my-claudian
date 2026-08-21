import { TabSession } from '@/features/chat/tabs/TabSession';

function createState() {
  return {
    conversationId: null,
    draftModel: null,
    id: 'tab-1',
    lifecycleState: 'cold' as const,
    providerId: 'claude' as const,
  };
}

describe('TabSession', () => {
  it('reports queued background work until it settles', async () => {
    let release!: () => void;
    const onWorkChanged = jest.fn();
    const session = new TabSession(createState(), onWorkChanged);
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
