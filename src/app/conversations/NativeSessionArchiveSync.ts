import type {
  ProviderId,
  ProviderSessionArchive,
  ProviderSessionArchiveChange,
} from '../../core/providers/types';
import type { Conversation } from '../../core/types';

export interface NativeSessionArchiveSyncDeps {
  getConversation(id: string): Conversation | null;
  getSessionArchive(providerId: ProviderId): Promise<ProviderSessionArchive | null>;
  onFailure(providerId: ProviderId, error: unknown): void;
}

/** Mirrors committed app archive state to provider-native storage without rolling it back. */
export class NativeSessionArchiveSync {
  private readonly pending = new Set<string>();
  private draining: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly deps: NativeSessionArchiveSyncDeps) {}

  sync(ids: Iterable<string>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    for (const id of ids) this.pending.add(id);
    if (this.pending.size > 0) this.draining ??= this.drain();
    return this.draining ?? Promise.resolve();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.draining;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.size > 0) {
        const ids = [...this.pending];
        this.pending.clear();
        const changesByProvider = new Map<ProviderId, ProviderSessionArchiveChange[]>();
        for (const id of ids) {
          const conversation = this.deps.getConversation(id);
          if (!conversation) continue;
          const changes = changesByProvider.get(conversation.providerId) ?? [];
          changes.push({ conversation, isArchived: conversation.isArchived === true });
          changesByProvider.set(conversation.providerId, changes);
        }
        await Promise.all([...changesByProvider].map(([providerId, changes]) => (
          this.apply(providerId, changes)
        )));
      }
    } finally {
      this.draining = null;
    }
  }

  private async apply(
    providerId: ProviderId,
    changes: ProviderSessionArchiveChange[],
  ): Promise<void> {
    try {
      const archive = await this.deps.getSessionArchive(providerId);
      await archive?.setSessionsArchived(changes);
    } catch (error) {
      this.deps.onFailure(providerId, error);
    }
  }
}
