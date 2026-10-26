import { OwnedProbeRegistry } from '@/core/providers/metadata/OwnedProbeRegistry';
import { ProviderTransitionFence } from '@/core/providers/metadata/ProviderTransitionFence';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { SlashCommand } from '@/core/types';
import { type AcpSessionNotification, normalizeAcpAvailableCommands } from '@/providers/acp';
import { toAbortError } from '@/utils/abort';

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
// Cursor appends the entry scope to descriptions, e.g. `(builtin skill)`.
const SKILL_SCOPE_SUFFIX = /\s*\((?:builtin|project|user|team|plugin) skill\)\s*$/u;
const DISPOSED_MESSAGE = 'Cursor command metadata probe is disposed.';
// Cursor advertises commands several seconds after session/new (~4s locally).
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
const COMMAND_CACHE_TTL_MS = 60_000;

interface CursorCommandDiscoveryFlight {
  readonly controller: AbortController;
  readonly promise: Promise<SlashCommand[]>;
  consumers: number;
  settled: boolean;
}

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
  private cachedCommands: { items: SlashCommand[]; expiresAt: number } | null = null;
  private discoveryFlight: CursorCommandDiscoveryFlight | null = null;
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

    signal?.throwIfAborted();
    if (this.cachedCommands && Date.now() < this.cachedCommands.expiresAt) {
      return structuredClone(this.cachedCommands.items);
    }
    const flight = this.discoveryFlight ?? this.startDiscovery();
    return await this.joinDiscovery(flight, signal);
  }

  invalidate(): void {
    this.cachedCommands = null;
    const flight = this.discoveryFlight;
    this.discoveryFlight = null;
    flight?.controller.abort(new Error(ABORT_MESSAGE));
  }

  private startDiscovery(): CursorCommandDiscoveryFlight {
    const controller = new AbortController();
    const promise = this.probes.run({
      create: () => this.createResource(),
      initialize: resource => resource.kernel.connect(),
      query: async (resource, ownedSignal) => {
        const session = await resource.kernel.openSession();
        resource.sessionId = session.sessionId;
        ownedSignal.throwIfAborted();
        return await resource.waitForCommands(session.sessionId, ownedSignal);
      },
    }, controller.signal).then(items => {
      controller.signal.throwIfAborted();
      this.cachedCommands = { items: structuredClone(items), expiresAt: Date.now() + COMMAND_CACHE_TTL_MS };
      return items;
    }).finally(() => {
      flight.settled = true;
      if (this.discoveryFlight === flight) this.discoveryFlight = null;
    });
    const flight: CursorCommandDiscoveryFlight = { controller, promise, consumers: 0, settled: false };
    this.discoveryFlight = flight;
    return flight;
  }

  private async joinDiscovery(
    flight: CursorCommandDiscoveryFlight,
    signal?: AbortSignal,
  ): Promise<SlashCommand[]> {
    flight.consumers++;
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        if (!signal) return;
        onAbort = () => reject(toAbortError(signal, ABORT_MESSAGE));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      return structuredClone(await Promise.race([flight.promise, aborted]));
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      flight.consumers--;
      if (flight.consumers === 0 && !flight.settled) {
        if (this.discoveryFlight === flight) this.discoveryFlight = null;
        flight.controller.abort(new Error(ABORT_MESSAGE));
      }
    }
  }

  beginEnvironmentTransition(): void {
    this.transitionFence.beginTransition();
    this.invalidate();
  }

  endEnvironmentTransition(): void {
    this.transitionFence.endTransition();
  }

  quiesceForEnvironmentChange(): Promise<void> {
    this.invalidate();
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
          normalizeCursorRuntimeCommands(notification.update.availableCommands),
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

/** Marks Cursor skill entries as skills and strips the scope suffix from their descriptions. */
export function normalizeCursorRuntimeCommands(
  commands: Parameters<typeof normalizeAcpAvailableCommands>[0],
): SlashCommand[] {
  return normalizeAcpAvailableCommands(commands).map((command) => {
    const description = command.description ?? '';
    if (!SKILL_SCOPE_SUFFIX.test(description)) return { ...command, kind: 'command' };
    const stripped = description.replace(SKILL_SCOPE_SUFFIX, '');
    return {
      ...command,
      ...(stripped ? { description: stripped } : { description: undefined }),
      kind: 'skill',
    };
  });
}
