import type { TabId } from './types';

export type TabSwitchExecutor = (tabId: TabId) => Promise<void>;

/**
 * Serializes tab activation requests while coalescing them to the latest
 * requested tab. It owns queue mechanics only; tab state and activation
 * semantics remain with the caller.
 */
export class TabSwitchCoordinator {
  private pendingTabId: TabId | null = null;
  private running = false;
  private requestRevision = 0;
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly isCurrentTab: (tabId: TabId) => boolean) {}

  async request(tabId: TabId, execute: TabSwitchExecutor): Promise<void> {
    this.requestRevision += 1;
    if (this.running) {
      this.pendingTabId = tabId;
      return;
    }

    this.running = true;
    let requestedTabId: TabId | null = tabId;
    try {
      while (requestedTabId) {
        this.pendingTabId = null;
        await execute(requestedTabId);
        const pendingTabId = this.pendingTabId;
        this.pendingTabId = null;
        requestedTabId = pendingTabId && !this.isCurrentTab(pendingTabId)
          ? pendingTabId
          : null;
      }
    } finally {
      this.running = false;
      this.resolveIdleWaiters();
    }
  }

  getRequestRevision(): number {
    return this.requestRevision;
  }

  async waitForIdle(): Promise<void> {
    while (this.running) {
      await new Promise<void>(resolve => {
        this.idleWaiters.add(resolve);
      });
    }
  }

  private resolveIdleWaiters(): void {
    if (this.running || this.pendingTabId) return;

    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }
}
