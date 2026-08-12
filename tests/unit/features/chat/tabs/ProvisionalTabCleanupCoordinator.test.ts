import { ProvisionalTabCleanupCoordinator } from '@/features/chat/tabs/ProvisionalTabCleanupCoordinator';

describe('ProvisionalTabCleanupCoordinator', () => {
  it('shares one active cleanup with concurrent callers', async () => {
    const coordinator = new ProvisionalTabCleanupCoordinator();
    const gate = deferred<void>();
    const task = jest.fn(() => gate.promise);

    const first = coordinator.run(task);
    await Promise.resolve();
    const second = coordinator.run(task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(coordinator.isRunning()).toBe(true);
    gate.resolve();
    await Promise.all([first, second]);
    expect(coordinator.isRunning()).toBe(false);
  });

  it('releases the coordinator when cleanup fails', async () => {
    const coordinator = new ProvisionalTabCleanupCoordinator();
    const error = new Error('cleanup failed');

    await expect(coordinator.run(async () => {
      throw error;
    })).rejects.toBe(error);
    expect(coordinator.isRunning()).toBe(false);
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
