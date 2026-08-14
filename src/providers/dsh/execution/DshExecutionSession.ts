import { randomUUID } from 'node:crypto';

import type {
  ProviderExecutionEvent,
  ProviderExecutionRequest,
  ProviderExecutionRun,
  ProviderExecutionSession,
  ProviderRequestedEventScope,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderSessionSnapshot,
  ProviderSessionStatus,
} from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { UsageInfo } from '@/core/types';
import {
  type AcpContentBlock,
  AcpExecutionEventNormalizer,
  type AcpSessionNotification,
} from '@/providers/acp';
import { appendContextFiles, appendCurrentNote } from '@/utils/context';
import { appendEditorContext } from '@/utils/editor';

import { decodeDshModelId } from '../models';
import {
  DefaultDshAcpSessionKernel,
  type DshAcpSessionKernel,
  type DshAcpSessionKernelOptions,
} from './DshAcpSessionKernel';

class EventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private closed = false;
  private values: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];

  constructor(private readonly onReturn: () => void) {}
  [Symbol.asyncIterator](): AsyncIterator<T> { return this; }
  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise(resolve => this.waiters.push(resolve));
  }
  return(): Promise<IteratorResult<T>> {
    if (!this.closed) this.onReturn();
    return Promise.resolve({ done: true, value: undefined });
  }
  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }
}

class DshExecutionRun implements ProviderExecutionRun {
  readonly executionId = randomUUID();
  readonly turnId = randomUUID();
  readonly queue: EventQueue<ProviderExecutionEvent>;
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  terminal = false;
  private sequence = 0;
  private _sessionInstanceId = '';

  constructor(private readonly cancelRun: () => void) {
    this.queue = new EventQueue(() => this.cancel());
    this.events = this.queue;
  }
  cancel(): void { if (!this.terminal) this.cancelRun(); }
  scope(): ProviderRequestedEventScope {
    return {
      executionId: this.executionId,
      kind: 'requested',
      sequence: ++this.sequence,
      sessionInstanceId: this._sessionInstanceId,
      turnId: this.turnId,
    };
  }
  setSessionInstanceId(value: string): void { this._sessionInstanceId = value; }
  finish(event: ProviderExecutionEvent): void {
    if (this.terminal) return;
    this.terminal = true;
    this.queue.push(event);
    this.queue.close();
  }
}

export interface DshExecutionSessionOptions {
  readonly createKernel?: (options: DshAcpSessionKernelOptions) => DshAcpSessionKernel;
}

export class DshExecutionSession implements ProviderExecutionSession {
  readonly providerId = 'dsh' as const;
  readonly sessionInstanceId = randomUUID();
  private readonly createKernel: (options: DshAcpSessionKernelOptions) => DshAcpSessionKernel;
  private readonly listeners = new Set<(event: ProviderSessionEvent) => void>();
  private kernel: DshAcpSessionKernel | null = null;
  private activeRun: DshExecutionRun | null = null;
  private nativeSessionId: string | null = null;
  private snapshot: ProviderSessionSnapshot;
  private sessionSequence = 0;
  private disposed = false;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly config: ProviderSessionConfig,
    options: DshExecutionSessionOptions = {},
  ) {
    this.createKernel = options.createKernel ?? (kernelOptions => new DefaultDshAcpSessionKernel(kernelOptions));
    this.snapshot = this.makeSnapshot('idle');
  }

  execute(request: ProviderExecutionRequest): ProviderExecutionRun {
    if (this.disposed) throw new Error('dsh execution session is disposed');
    if (this.activeRun) throw new Error('dsh execution session already has an active run');
    const run = new DshExecutionRun(() => this.cancelRun(run));
    run.setSessionInstanceId(this.sessionInstanceId);
    this.activeRun = run;
    void this.startRun(run, request);
    return run;
  }
  cancel(): void { this.activeRun?.cancel(); }
  getSnapshot(): ProviderSessionSnapshot { return this.snapshot; }
  getStatus(): ProviderSessionStatus { return this.snapshot.status; }
  onEvent(listener: (event: ProviderSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.activeRun?.finish({ reason: 'session-disposed', scope: this.activeRun.scope(), type: 'cancelled' });
    this.activeRun = null;
    this.snapshot = this.makeSnapshot('disposed');
    await this.kernel?.dispose();
    this.kernel = null;
    this.listeners.clear();
  }

  private async startRun(run: DshExecutionRun, request: ProviderExecutionRequest): Promise<void> {
    try {
      if (!this.kernel) {
        this.kernel = this.createKernel({
          config: this.config,
          getActiveTurnId: () => this.activeRun?.turnId ?? null,
          onClosed: error => { if (this.activeRun) this.failRun(this.activeRun, error); },
          onNotification: notification => { if (this.activeRun) this.handleNotification(this.activeRun, notification); },
          plugin: this.plugin,
        });
        await this.kernel.connect();
      }
      this.nativeSessionId = (await this.kernel.openSession()).sessionId;
      this.snapshot = this.makeSnapshot('executing');
      this.emitSnapshot(run);
      const normalizer = new AcpExecutionEventNormalizer({
        scope: {
          executionId: run.executionId,
          kind: 'requested',
          sessionInstanceId: this.sessionInstanceId,
          turnId: run.turnId,
        },
      });
      this.normalizers.set(run, normalizer);
      run.queue.push({
        scope: run.scope(),
        type: 'usage_updated',
        usage: buildInitialDshUsageInfo(decodeDshModelId(request.configuration.model ?? '') ?? undefined),
      });
      const response = await this.kernel.prompt({
        prompt: buildDshPrompt(request),
        sessionId: this.nativeSessionId,
      });
      if (run.terminal) return;
      run.queue.push({ accepted: true, nativeUserMessageId: response.userMessageId ?? undefined, scope: run.scope(), type: 'turn_started' });
      this.snapshot = this.makeSnapshot('idle');
      this.emitSnapshot(run);
      run.finish({ reason: 'completed', scope: run.scope(), type: 'turn_completed' });
      this.activeRun = null;
    } catch (error) {
      this.failRun(run, error);
    }
  }

  private readonly normalizers = new WeakMap<DshExecutionRun, AcpExecutionEventNormalizer>();

  private handleNotification(run: DshExecutionRun, notification: AcpSessionNotification): void {
    if (run.terminal || notification.sessionId !== this.nativeSessionId) return;
    const result = this.normalizers.get(run)?.normalize(notification.update);
    for (const event of result?.events ?? []) run.queue.push({ ...event, scope: run.scope() });
  }
  private cancelRun(run: DshExecutionRun): void {
    if (this.activeRun !== run || run.terminal) return;
    if (this.nativeSessionId) this.kernel?.cancel(this.nativeSessionId);
    run.finish({ reason: 'cancelled', scope: run.scope(), type: 'cancelled' });
    this.activeRun = null;
  }
  private failRun(run: DshExecutionRun, error: unknown): void {
    if (run.terminal) return;
    const message = error instanceof Error ? error.message : String(error);
    this.snapshot = { ...this.makeSnapshot('invalidated'), invalidation: { message, reason: 'provider-error', recoverable: true }, status: 'invalidated' };
    run.finish({ category: 'provider', message, recoverable: true, scope: run.scope(), type: 'execution_error' });
    this.activeRun = null;
  }
  private emitSnapshot(run: DshExecutionRun): void {
    run.queue.push({ scope: run.scope(), snapshot: this.snapshot, type: 'session_state_changed' });
    const event: ProviderSessionEvent = {
      scope: {
        kind: 'session',
        sequence: ++this.sessionSequence,
        sessionInstanceId: this.sessionInstanceId,
      },
      snapshot: this.snapshot,
      type: 'session_state_changed',
    };
    for (const listener of this.listeners) listener(event);
  }
  private makeSnapshot(status: ProviderSessionStatus): ProviderSessionSnapshot {
    if (status === 'invalidated') {
      return {
        providerId: this.providerId,
        providerSessionId: this.nativeSessionId ?? undefined,
        revision: Date.now(),
        status,
        invalidation: { reason: 'provider-error', recoverable: true },
      };
    }
    return {
      providerId: this.providerId,
      providerSessionId: this.nativeSessionId ?? undefined,
      revision: Date.now(),
      status,
    };
  }
}

export function buildDshPrompt(request: ProviderExecutionRequest): AcpContentBlock[] {
  let text = request.input.filter(block => block.type === 'text').map(block => block.text).join('\n');
  if (request.context?.currentNote?.path) text = appendCurrentNote(text, request.context.currentNote.path);
  if (request.context?.editorSelection) text = appendEditorContext(text, request.context.editorSelection);
  if (request.context?.contextFiles?.length) text = appendContextFiles(text, [...request.context.contextFiles]);
  return [{ type: 'text', text }];
}

export function buildInitialDshUsageInfo(model?: string): UsageInfo {
  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextTokens: 0,
    contextWindow: 200_000,
    contextWindowIsAuthoritative: false,
    inputTokens: 0,
    ...(model ? { model } : {}),
    percentage: 0,
  };
}
