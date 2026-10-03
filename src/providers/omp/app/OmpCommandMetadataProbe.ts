import { OwnedProbeRegistry } from '@/core/providers/metadata/OwnedProbeRegistry';
import { ProviderTransitionFence } from '@/core/providers/metadata/ProviderTransitionFence';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { SlashCommand } from '@/core/types';
import { type AcpSessionNotification, normalizeAcpAvailableCommands } from '@/providers/acp';

import {
  DefaultOmpAcpSessionKernel,
  type OmpAcpSessionKernel,
  type OmpAcpSessionKernelOptions,
} from '../execution/OmpAcpSessionKernel';
import { getOmpMetadataSessionConfig } from '../metadata/OmpModelDiscoveryService';

const ABORT_MESSAGE = 'OMP command metadata probe aborted';
const DISPOSED_MESSAGE = 'OMP command metadata probe is disposed.';
// OMP pushes available commands right after session/new (~50ms locally).
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const SKILL_COMMAND_PREFIX = 'skill:';

interface OmpCommandProbeResource {
  readonly kernel: OmpAcpSessionKernel;
  readonly waitForCommands: (sessionId: string, signal: AbortSignal) => Promise<SlashCommand[]>;
}

export interface OmpCommandMetadataProbeOptions {
  readonly commandTimeoutMs?: number;
  readonly createKernel?: (options: OmpAcpSessionKernelOptions) => OmpAcpSessionKernel;
}

/**
 * Reads OMP's ACP `available_commands_update` from an isolated metadata
 * session. The native session is stored in a private temporary directory so
 * discovery never adds entries to the user's OMP history.
 */
export class OmpCommandMetadataProbe {
  private readonly commandTimeoutMs: number;
  private readonly createKernel: (options: OmpAcpSessionKernelOptions) => OmpAcpSessionKernel;
  private disposeFlight: Promise<void> | null = null;
  private readonly probes: OwnedProbeRegistry<OmpCommandProbeResource>;
  private readonly transitionFence = new ProviderTransitionFence({
    abortMessage: ABORT_MESSAGE,
  });

  constructor(
    private readonly plugin: ProviderHost,
    options: OmpCommandMetadataProbeOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.createKernel = options.createKernel
      ?? (kernelOptions => new DefaultOmpAcpSessionKernel(kernelOptions));
    this.probes = new OwnedProbeRegistry({
      abortMessage: ABORT_MESSAGE,
      dispose: resource => resource.kernel.dispose(),
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

  private createResource(): OmpCommandProbeResource {
    // Notifications can arrive before session/new resolves, so buffer them by session.
    const advertised = new Map<string, SlashCommand[]>();
    const waiters = new Set<() => void>();
    const kernel = this.createKernel({
      approvalMode: 'always-ask',
      config: getOmpMetadataSessionConfig(this.plugin),
      getActiveTurnId: () => null,
      isolateNativeSessions: true,
      onClosed: () => undefined,
      onNotification: (notification: AcpSessionNotification) => {
        if (notification.update.sessionUpdate !== 'available_commands_update') return;
        advertised.set(
          notification.sessionId,
          normalizeOmpRuntimeCommands(notification.update.availableCommands),
        );
        for (const wake of [...waiters]) wake();
      },
      plugin: this.plugin,
    });

    const waitForCommands = (sessionId: string, signal: AbortSignal): Promise<SlashCommand[]> => (
      new Promise<SlashCommand[]>((resolve, reject) => {
        const settle = (): boolean => {
          const commands = advertised.get(sessionId);
          if (!commands) return false;
          cleanup();
          resolve(commands);
          return true;
        };
        const onAbort = (): void => {
          cleanup();
          reject(signal.reason instanceof Error ? signal.reason : new Error(ABORT_MESSAGE));
        };
        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error('OMP did not advertise commands for the metadata session.'));
        }, this.commandTimeoutMs);
        const wake = (): void => { settle(); };
        function cleanup(): void {
          window.clearTimeout(timeoutId);
          waiters.delete(wake);
          signal.removeEventListener('abort', onAbort);
        }
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        waiters.add(wake);
        settle();
      })
    );

    return { kernel, waitForCommands };
  }
}

/** OMP advertises skills as `skill:<name>` commands; keep the name and mark the kind. */
export function normalizeOmpRuntimeCommands(
  commands: Parameters<typeof normalizeAcpAvailableCommands>[0],
): SlashCommand[] {
  return normalizeAcpAvailableCommands(commands).map(command => ({
    ...command,
    kind: command.name.startsWith(SKILL_COMMAND_PREFIX) ? 'skill' : 'command',
  }));
}
