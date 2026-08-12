import { ConversationNavigationQueue } from '@/features/chat/tabs/ConversationNavigationQueue';

describe('ConversationNavigationQueue', () => {
  it('drops an earlier request before it starts when a newer one is queued', async () => {
    const queue = new ConversationNavigationQueue();
    const gate = deferred<void>();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first');
      await gate.promise;
    });
    await Promise.resolve();
    const second = queue.enqueue(async () => {
      events.push('second');
    });

    gate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(['second']);
  });

  it('allows a later request after a failed task', async () => {
    const queue = new ConversationNavigationQueue();
    const later = jest.fn().mockResolvedValue(undefined);

    await expect(queue.enqueue(async () => {
      throw new Error('navigation failed');
    })).rejects.toThrow('navigation failed');
    await queue.enqueue(later);

    expect(later).toHaveBeenCalledTimes(1);
  });

  it('invalidates queued navigation before draining it', async () => {
    const queue = new ConversationNavigationQueue();
    const gate = deferred<void>();
    const stale = jest.fn().mockResolvedValue(undefined);

    const active = queue.enqueue(() => gate.promise);
    const pending = queue.enqueue(stale);
    const drain = queue.invalidateAndDrain();
    gate.resolve();

    await Promise.all([active, pending, drain]);
    expect(stale).not.toHaveBeenCalled();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
}
