import { ProviderTransitionFence } from '../../../core/providers/metadata/ProviderTransitionFence';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ProviderSessionArchive,
  ProviderSessionArchiveChange,
} from '../../../core/providers/types';
import { CodexAppServerProcess } from '../runtime/CodexAppServerProcess';
import {
  initializeCodexAppServerTransport,
  resolveCodexAppServerLaunchSpec,
} from '../runtime/codexAppServerSupport';
import {
  CodexRpcResponseError,
  CodexRpcTransport,
} from '../runtime/CodexRpcTransport';
import { getCodexState } from '../types';

const ALREADY_IN_STATE_MESSAGE = /^no (archived )?rollout found for thread id /;

/** Mirrors Claudian archive changes to Codex through a short-lived app-server. */
export class CodexThreadArchiveService implements ProviderSessionArchive {
  private readonly active = new Set<Promise<void>>();
  private readonly transitionFence = new ProviderTransitionFence({
    abortMessage: 'Codex session archive wait aborted',
  });

  constructor(private readonly plugin: ProviderHost) {}

  async setSessionsArchived(changes: readonly ProviderSessionArchiveChange[]): Promise<void> {
    const requests = changes.flatMap(({ conversation, isArchived }) => {
      const state = getCodexState(conversation.providerState);
      // A fork without its own thread must never target the source session.
      const threadId = state.threadId ?? conversation.sessionId;
      return threadId ? [{ threadId, isArchived }] : [];
    });
    if (requests.length === 0) return;

    while (this.transitionFence.isUnavailable()) {
      if (!await this.transitionFence.waitUntilAvailable()) return;
    }
    const operation = this.apply(requests);
    this.active.add(operation);
    try {
      await operation;
    } finally {
      this.active.delete(operation);
    }
  }

  beginEnvironmentTransition(): void {
    this.transitionFence.beginTransition();
  }

  endEnvironmentTransition(): void {
    this.transitionFence.endTransition();
  }

  async quiesceForEnvironmentChange(): Promise<void> {
    await Promise.allSettled([...this.active]);
  }

  async dispose(): Promise<void> {
    this.transitionFence.dispose();
    await this.quiesceForEnvironmentChange();
  }

  private async apply(
    requests: ReadonlyArray<{ threadId: string; isArchived: boolean }>,
  ): Promise<void> {
    const launchSpec = await resolveCodexAppServerLaunchSpec(this.plugin, 'codex');
    const process = new CodexAppServerProcess(launchSpec);
    process.start();
    const transport = new CodexRpcTransport(process);
    transport.start();
    try {
      await initializeCodexAppServerTransport(transport);
      let firstFailure: Error | undefined;
      for (const { threadId, isArchived } of requests) {
        try {
          await transport.request(isArchived ? 'thread/archive' : 'thread/unarchive', { threadId });
        } catch (error) {
          if (error instanceof CodexRpcResponseError && ALREADY_IN_STATE_MESSAGE.test(error.message)) {
            continue;
          }
          firstFailure ??= error instanceof Error ? error : new Error(String(error));
        }
      }
      if (firstFailure) throw firstFailure;
    } finally {
      transport.dispose();
      await process.shutdown();
    }
  }
}
