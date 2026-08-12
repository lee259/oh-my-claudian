export type ProvisionalCleanupTask = () => Promise<void>;

/** Ensures concurrent provisional-tab cleanup requests share one teardown. */
export class ProvisionalTabCleanupCoordinator {
  private activeCleanup: Promise<void> | null = null;

  isRunning(): boolean {
    return this.activeCleanup !== null;
  }

  async run(task: ProvisionalCleanupTask): Promise<void> {
    if (this.activeCleanup) {
      await this.activeCleanup;
      return;
    }

    const cleanup = Promise.resolve()
      .then(task)
      .finally(() => {
        if (this.activeCleanup === cleanup) this.activeCleanup = null;
      });
    this.activeCleanup = cleanup;
    await cleanup;
  }

  async waitForIdle(): Promise<void> {
    await this.activeCleanup;
  }
}
