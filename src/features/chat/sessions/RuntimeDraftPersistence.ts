import type { ComposerDraftScope, ComposerDraftStorage } from '../../../core/bootstrap/ComposerDraftStorage';
import type { RuntimeComposer } from './RuntimeComposer';

type DraftIdentity = { scope: ComposerDraftScope; id: string };

/** Persists one runtime's unsent text independently of its replaceable presentation. */
export class RuntimeDraftPersistence {
  private timer: number | null = null;
  private pending = false;
  private revision = 0;
  private restoring = false;
  private pendingRemovals: DraftIdentity[] = [];
  private flight: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly composer: RuntimeComposer,
    private readonly storage: Pick<ComposerDraftStorage, 'read' | 'write'>,
    private identity: DraftIdentity,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    this.unsubscribe = composer.subscribe(() => {
      if (this.restoring) return;
      this.revision++;
      this.pending = true;
      this.schedule();
    });
  }

  async initialize(): Promise<void> {
    const revision = this.revision;
    const identity = this.identity;
    const text = await this.storage.read(identity.scope, identity.id);
    if (this.revision !== revision || this.identity !== identity) return;
    this.restoring = true;
    try { this.composer.value = text; } finally { this.restoring = false; }
  }

  rebind(identity: DraftIdentity): void {
    if (identity.scope === this.identity.scope && identity.id === this.identity.id) return;
    const previous = this.identity;
    this.identity = identity;
    this.revision++;
    this.pending = true;
    this.pendingRemovals.push(previous);
    this.schedule();
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.pending) {
      const identity = this.identity;
      const text = this.composer.value;
      const revision = this.revision;
      const removals = this.pendingRemovals.filter(old => old.scope !== identity.scope || old.id !== identity.id);
      this.pendingRemovals = [];
      this.pending = false;
      this.enqueue(async () => {
        try {
          await this.storage.write(identity.scope, identity.id, text);
          for (const old of removals) await this.storage.write(old.scope, old.id, '');
        } catch (error) {
          this.pendingRemovals.push(...removals);
          if (this.identity === identity && this.revision === revision) this.pending = true;
          else if (removals.length > 0) this.pending = true;
          throw error;
        }
      });
    }
    await this.flight;
  }

  async dispose(): Promise<void> {
    this.unsubscribe();
    await this.flush();
  }

  async discard(): Promise<void> {
    this.unsubscribe();
    this.cancelTimer();
    this.pending = false;
    const identity = this.identity;
    this.enqueue(async () => {
      const removals = [...this.pendingRemovals, identity];
      this.pendingRemovals = [];
      for (const old of removals) await this.storage.write(old.scope, old.id, '');
    });
    await this.flight;
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush().catch(this.onError);
    }, 300);
  }

  private cancelTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private enqueue(work: () => Promise<void>): void {
    this.flight = this.flight.catch(() => undefined).then(work);
  }
}
