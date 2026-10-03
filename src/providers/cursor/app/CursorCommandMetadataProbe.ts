import { OwnedProbeRegistry } from '@/core/providers/metadata/OwnedProbeRegistry';
import { ProviderTransitionFence } from '@/core/providers/metadata/ProviderTransitionFence';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { SlashCommand } from '@/core/types';
import { type AcpSessionNotification, normalizeAcpAvailableCommands } from '@/providers/acp';

import {
  type CursorAcpSessionKernel,
  type CursorAcpSessionKernelOptions,
  DefaultCursorAcpSessionKernel,
} from '../execution/CursorAcpSessionKernel';
import {
  getCursorMetadataSessionConfig,
  removeUnusedCursorProbeSession,
} from '../metadata/CursorMetadataSession';

const ABORT_MESSAGE = 'Cursor command metadata probe aborted';
const DISPOSED_MESSAGE = 'Cursor command metadata probe is disposed.';
// Cursor advertises commands several seconds after session/new (~4s locally).
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

interface CursorCommandProbeResource {
  readonly kernel: CursorAcpSessionKernel;
  sessionId: string | null;
  readonly waitForCommands: (sessionId: string, signal: AbortSignal) => Promise<SlashCommand[]>;
}

export interface CursorCommandMetadataProbeOptions {
  readonly commandTimeoutMs?: number;
  readonly createKernel?: (options: CursorAcpSessionKernelOptions) => CursorAcpSessionKernel;
  readonly removeProbeSession?: (sessionId: string) => Promise<void>;
}

/**
 * Reads Cursor's ACP `available_commands_update` from a short-lived metadata
 * session. Cursor has no session directory override or session/close, so the
 * prompt-less session folder is removed after the probe.
 */
export class CursorCommandMetadataProbe {
  private readonly commandTimeoutMs: number;
  private readonly createKernel: (options: CursorAcpSessionKernelOptions) => CursorAcpSessionKernel;
  private disposeFlight: Promise<void> | null = null;
  private readonly probes: OwnedProbeRegistry<CursorCommandProbeResource>;
  private readonly removeProbeSession: (sessionId: string) => Promise<void>;
  private readonly transitionFence = new ProviderTransitionFence({
    abortMessage: ABORT_MESSAGE,
  });

  constructor(
    private readonly plugin: ProviderHost,
    options: CursorCommandMetadataProbeOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.createKernel = options.createKernel
      ?? (kernelOptions => new DefaultCursorAcpSessionKernel(kernelOptions));
    this.removeProbeSession = options.removeProbeSession
      ?? (sessionId => removeUnusedCursorProbeSession(sessionId));
    this.probes = new OwnedProbeRegistry({
      abortMessage: ABORT_MESSAGE,
      dispose: async (resource) => {
        await resource.kernel.dispose();
        if (resource.sessionId) await this.removeProbeSession(resource.sessionId);
      },
      unavailableError: () => new Error(DISPOSED_MESSAGE),
    });
  }

  async load(signal?: AbortSignal): Promise<SlashCommand[]> {
    if (this.transitionFence.isUnavailable()) {
      const available = await this.transitionFence.waitUntilAvailable(signal);
      if (!available) throw new Error(DISPOSED_MESSAGE);
    }

    return await this.probes.run({
      create: () => this.createResource(),
      initialize: resource => resource.kernel.connect(),
      query: async (resource, ownedSignal) => {
        const session = await resource.kernel.openSession();
        resource.sessionId = session.sessionId;
        ownedSignal.throwIfAborted();
        return await resource.waitForCommands(session.sessionId, ownedSignal);
      },
    }, signal);
  }

  beginEnvironmentTransition(): void {
    this.transitionFence.beginTransition();
  }

  endEnvironmentTransition(): void {
    this.transitionFence.endTransition();
  }

  quiesceForEnvironmentChange(): Promise<void> {
    return this.probes.quiesce();
  }

  dispose(): Promise<void> {
    if (this.disposeFlight) return this.disposeFlight;
    this.transitionFence.dispose();
    this.disposeFlight = (async () => {
      await this.quiesceForEnvironmentChange();
      await this.probes.dispose();
    })();
    return this.disposeFlight;
  }

  private createResource(): CursorCommandProbeResource {
    // Notifications can arrive before session/new resolves, so buffer them by session.
    const advertised = new Map<string, SlashCommand[]>();
    const waiters = new Set<() => void>();
    const kernel = this.createKernel({
      config: getCursorMetadataSessionConfig(this.plugin),
      getActiveTurnId: () => null,
      onClosed: () => undefined,
      onNotification: (notification: AcpSessionNotification) => {
        if (notification.update.sessionUpdate !== 'available_commands_update') return;
        advertised.set(
          notification.sessionId,
          normalizeAcpAvailableCommands(notification.update.availableCommands),
        );
        for (const wake of [...waiters]) wake();
      },
      plugin: this.plugin,
      sessionInstanceId: 'cursor-command-metadata',
    });

    const waitForCommands = (sessionId: string, signal: AbortSignal): Promise<SlashCommand[]> => (
      new Promise<SlashCommand[]>((resolve, reject) => {
        const settle = (): void => {
          const commands = advertised.get(sessionId);
          if (!commands) return;
          cleanup();
          resolve(commands);
        };
        const onAbort = (): void => {
          cleanup();
          reject(signal.reason instanceof Error ? signal.reason : new Error(ABORT_MESSAGE));
        };
        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error('Cursor did not advertise commands for the metadata session.'));
        }, this.commandTimeoutMs);
        function cleanup(): void {
          window.clearTimeout(timeoutId);
          waiters.delete(settle);
          signal.removeEventListener('abort', onAbort);
        }
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        waiters.add(settle);
        settle();
      })
    );

    return { kernel, sessionId: null, waitForCommands };
  }
}
