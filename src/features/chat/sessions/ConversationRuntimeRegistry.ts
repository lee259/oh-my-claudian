import type { ConversationRuntime } from './ConversationRuntime';

export interface ConversationRuntimeAttachment {
  readonly runtimeId: string;
  readonly ownerId: string;
}

export type RuntimeAttachmentResult =
  | { readonly kind: 'attached'; readonly handle: ConversationRuntimeAttachment }
  | { readonly kind: 'existing'; readonly handle: ConversationRuntimeAttachment };

/** Reserves one runtime per conversation before asynchronous hydration starts. */
export class ConversationRuntimeRegistry {
  private closed = false;
  private readonly lateDisposalErrors: Error[] = [];
  private disposal: Promise<void> | null = null;

  constructor(private readonly disposeRuntime: (runtime: ConversationRuntime) => Promise<void> = async runtime => {
    runtime.state.dismissInteractions('session-disposed');
    await runtime.disposeExecutionCoordinator();
    await runtime.activeTurn?.catch(() => undefined);
    await runtime.awaitBackgroundWork();
  }) {}

  private readonly runtimes = new Map<string, ConversationRuntime>();
  private readonly byRuntimeId = new Map<string, ConversationRuntime>();
  private readonly attachments = new Map<string, ConversationRuntimeAttachment>();
  private readonly reservations = new Map<string, Promise<ConversationRuntime>>();

  get(id: string): ConversationRuntime | null {
    return this.runtimes.get(id) ?? null;
  }

  getAttachment(runtimeId: string): ConversationRuntimeAttachment | null {
    return this.attachments.get(runtimeId) ?? null;
  }

  attach(runtimeId: string, ownerId: string): RuntimeAttachmentResult {
    if (this.closed) throw new Error('Conversation runtime registry is closed.');
    if (!this.byRuntimeId.has(runtimeId)) throw new Error('Cannot attach an unknown conversation runtime.');
    const existing = this.getAttachment(runtimeId);
    if (existing) return { kind: 'existing', handle: existing };
    const handle = Object.freeze({ runtimeId, ownerId });
    this.attachments.set(runtimeId, handle);
    return { kind: 'attached', handle };
  }

  detach(handle: ConversationRuntimeAttachment): boolean {
    if (this.attachments.get(handle.runtimeId) !== handle) return false;
    this.attachments.delete(handle.runtimeId);
    return true;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.attachments.clear();
    this.disposal = (async () => {
      await Promise.allSettled([...this.reservations.values()]);
      const results = await Promise.allSettled([...this.byRuntimeId.values()].map(runtime => this.disposeRuntime(runtime)));
      this.runtimes.clear();
      this.byRuntimeId.clear();
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
      errors.push(...this.lateDisposalErrors);
      if (errors.length) throw new AggregateError(errors, 'Conversation runtime cleanup failed.');
    })();
    return this.disposal;
  }

  getOrCreate(id: string, create: () => Promise<ConversationRuntime>): Promise<ConversationRuntime> {
    if (this.closed) return Promise.reject(new Error('Conversation runtime registry is closed.'));
    const runtime = this.get(id);
    if (runtime) return Promise.resolve(runtime);
    const reserved = this.reservations.get(id);
    if (reserved) return reserved;
    const pending = Promise.resolve().then(create).then(async created => {
      if (this.closed) {
        try { await this.disposeRuntime(created); } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          this.lateDisposalErrors.push(failure);
          throw failure;
        }
        throw new Error('Conversation runtime registry is closed.');
      }
      if (created.conversationId !== id) throw new Error('Runtime conversation does not match its reservation.');
      if (this.byRuntimeId.has(created.id)) throw new Error('Duplicate conversation runtime ID.');
      this.byRuntimeId.set(created.id, created);
      this.runtimes.set(id, created);
      return created;
    }).finally(() => {
      if (this.reservations.get(id) === pending) this.reservations.delete(id);
    });
    this.reservations.set(id, pending);
    return pending;
  }
}
