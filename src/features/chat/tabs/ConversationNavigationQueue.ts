export type ConversationNavigationTask = () => Promise<void>;

/**
 * Serializes conversation navigation and drops stale requests before they
 * start. Failed navigation is isolated so a later request can still run.
 */
export class ConversationNavigationQueue {
  private requestRevision = 0;
  private tail: Promise<void> = Promise.resolve();

  async enqueue(task: ConversationNavigationTask): Promise<void> {
    const requestRevision = ++this.requestRevision;
    const pending = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (requestRevision !== this.requestRevision) return;
        await task();
      });
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    await pending;
  }

  async invalidateAndDrain(): Promise<void> {
    this.requestRevision += 1;
    await this.tail;
  }
}
