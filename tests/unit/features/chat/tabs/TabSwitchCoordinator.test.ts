import { TabSwitchCoordinator } from '@/features/chat/tabs/TabSwitchCoordinator';

describe('TabSwitchCoordinator', () => {
  it('coalesces overlapping requests to the latest non-current tab', async () => {
    let currentTabId = 'tab-1';
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    const coordinator = new TabSwitchCoordinator(tabId => tabId === currentTabId);
    const execute = jest.fn(async (tabId: string) => {
      events.push(`start:${tabId}`);
      if (tabId === 'tab-2') await firstStarted;
      currentTabId = tabId;
      events.push(`finish:${tabId}`);
    });

    const firstRequest = coordinator.request('tab-2', execute);
    await Promise.resolve();
    await coordinator.request('tab-3', execute);
    releaseFirst();
    await firstRequest;

    expect(events).toEqual([
      'start:tab-2',
      'finish:tab-2',
      'start:tab-3',
      'finish:tab-3',
    ]);
    expect(coordinator.getRequestRevision()).toBe(2);
  });

  it('resolves idle waiters after the queued request finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const coordinator = new TabSwitchCoordinator(() => false);
    const request = coordinator.request('tab-1', async () => gate);
    const idle = coordinator.waitForIdle();

    let idleResolved = false;
    void idle.then(() => {
      idleResolved = true;
    });
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    release();
    await request;
    await idle;
    expect(idleResolved).toBe(true);
  });
});
