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
  private readonly subscriptions = new Map<string, () => void>();

  constructor(private readonly disposeRuntime: (runtime: ConversationRuntime) => Promise<void> = async runtime => {
    runtime.lifecycleState = 'closing';
    runtime.state.dismissInteractions('session-disposed');
    runtime.services.titleGenerationService?.cancel();
    runtime.services.instructionRefineService?.cancel();
    try {
      await runtime.hydrationWork?.catch(() => undefined);
      await runtime.stop();
      await runtime.controllers.conversationController?.save(false);
    } finally {
      try { await runtime.disposeExecutionCoordinator(); } finally {
        runtime.disposeModels();
      }
    }
  }, private readonly onChanged: () => void = () => undefined) {}

  private readonly byRuntimeId = new Map<string, ConversationRuntime>();
  private readonly attachments = new Map<string, ConversationRuntimeAttachment>();
  private readonly reservations = new Map<string, Promise<ConversationRuntime>>();

  get(id: string): ConversationRuntime | null {
    return this.getAll().find(runtime => runtime.conversationId === id) ?? null;
  }

  getAll(): readonly ConversationRuntime[] {
    return [...this.byRuntimeId.values()];
  }

  /** Adopts existing tab allocation while creation and presentation migrate separately. */
  register(runtime: ConversationRuntime): () => void {
    if (this.closed) throw new Error('Conversation runtime registry is closed.');
    if (this.byRuntimeId.has(runtime.id)) throw new Error('Duplicate conversation runtime ID.');
    this.byRuntimeId.set(runtime.id, runtime);
    const status = () => JSON.stringify([runtime.conversationId, runtime.isRunning, runtime.hasWork, runtime.state.attention]);
    let previous = status();
    this.subscriptions.set(runtime.id, runtime.subscribe(() => {
      const current = status();
      if (current === previous) return;
      previous = current;
      this.onChanged();
    }));
    const release = () => {
      if (this.byRuntimeId.get(runtime.id) !== runtime) return;
      this.subscriptions.get(runtime.id)?.();
      this.subscriptions.delete(runtime.id);
      this.byRuntimeId.delete(runtime.id);
      this.attachments.delete(runtime.id);
      runtime.releaseRegistration = null;
      this.onChanged();
    };
    runtime.releaseRegistration = release;
    return release;
  }

  getByRuntimeId(id: string): ConversationRuntime | null { return this.byRuntimeId.get(id) ?? null; }

  async retire(runtime: ConversationRuntime): Promise<void> {
    runtime.lifecycleState = 'closing';
    try { await this.disposeRuntime(runtime); } finally { runtime.releaseRegistration?.(); }
  }

  isRunning(conversationId: string): boolean {
    return this.getAll().some(runtime => runtime.conversationId === conversationId && runtime.isRunning);
  }

  hasWork(conversationId: string): boolean {
    return this.getAll().some(runtime => runtime.conversationId === conversationId && runtime.hasWork);
  }

  async stop(conversationId: string): Promise<void> {
    await Promise.all(this.getAll().filter(runtime => runtime.conversationId === conversationId)
      .map(runtime => runtime.stop()));
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
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    this.disposal = (async () => {
      await Promise.allSettled([...this.reservations.values()]);
      const results = await Promise.allSettled([...this.byRuntimeId.values()].map(runtime => this.disposeRuntime(runtime)));
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
      this.register(created);
      return created;
    }).finally(() => {
      if (this.reservations.get(id) === pending) this.reservations.delete(id);
    });
    this.reservations.set(id, pending);
    return pending;
  }
}
