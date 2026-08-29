/** Defers review attention while a queued continuation starts in the same conversation. */
export class DeferredReviewableSettlement {
  private pending: { conversationId: string | null; report: () => void } | null = null;

  defer(conversationId: string | null, report: (() => void) | null): void {
    if (report) this.pending = { conversationId, report };
  }

  hasFor(conversationId: string | null): boolean {
    this.discardForDifferentConversation(conversationId);
    return this.pending !== null;
  }

  takeFor(conversationId: string | null): (() => void) | null {
    if (!this.hasFor(conversationId)) return null;
    const report = this.pending?.report ?? null;
    this.clear();
    return report;
  }

  discardForDifferentConversation(conversationId: string | null): void {
    if (this.pending?.conversationId !== conversationId) this.clear();
  }

  clear(): void {
    this.pending = null;
  }
}
