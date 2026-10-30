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
import { reportResolvedTurnPrompt } from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { UsageInfo } from '@/core/types';
import { t } from '@/i18n/i18n';
import {
  type AcpContentBlock,
  AcpExecutionEventNormalizer,
  type AcpSessionNotification,
  type AcpUsage,
  type AcpUsageUpdate,
  buildAcpUsageInfo,
} from '@/providers/acp';
import { appendContextFiles, appendCurrentNote } from '@/utils/context';
import { appendEditorContext } from '@/utils/editor';

import { decodeHermesModelId } from '../models';
import {
  DefaultHermesAcpSessionKernel,
  type HermesAcpSessionKernel,
  type HermesAcpSessionKernelOptions,
} from './HermesAcpSessionKernel';

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

class HermesExecutionRun implements ProviderExecutionRun {
  readonly executionId = randomUUID();
  readonly turnId = randomUUID();
  readonly queue: EventQueue<ProviderExecutionEvent>;
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  terminal = false;
  accepted = false;
  readonly pendingTools = new Map<string, { kind: 'main' }>();
  private sequence = 0;

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
      sessionInstanceId: this.sessionInstanceId,
      turnId: this.turnId,
    };
  }

  get sessionInstanceId(): string { return this._sessionInstanceId; }
  setSessionInstanceId(value: string): void { this._sessionInstanceId = value; }
  finish(event: ProviderExecutionEvent): void {
    if (this.terminal) return;
    this.terminal = true;
    this.queue.push(event);
    this.queue.close();
  }

  private _sessionInstanceId = '';
}

export interface HermesExecutionSessionOptions {
  readonly createKernel?: (options: HermesAcpSessionKernelOptions) => HermesAcpSessionKernel;
}

export class HermesExecutionSession implements ProviderExecutionSession {
  readonly providerId = 'hermes' as const;
  readonly sessionInstanceId = randomUUID();
  private readonly createKernel: (options: HermesAcpSessionKernelOptions) => HermesAcpSessionKernel;
  private readonly listeners = new Set<(event: ProviderSessionEvent) => void>();
  private kernel: HermesAcpSessionKernel | null = null;
  private nativeSessionId: string | null;
  private activeRun: HermesExecutionRun | null = null;
  private snapshot: ProviderSessionSnapshot;
  private lastUsage: UsageInfo | null = null;
  private disposed = false;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly config: ProviderSessionConfig,
    options: HermesExecutionSessionOptions = {},
  ) {
    this.createKernel = options.createKernel ?? (kernelOptions => new DefaultHermesAcpSessionKernel(kernelOptions));
    this.nativeSessionId = config.resumeSeed?.providerSessionId ?? null;
    this.snapshot = this.makeSnapshot('idle');
  }

  execute(request: ProviderExecutionRequest): ProviderExecutionRun {
    if (this.disposed) throw new Error('Hermes execution session is disposed');
    if (this.activeRun) throw new Error('Hermes execution session already has an active run');
    const run = new HermesExecutionRun(() => this.cancelRun(run));
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
    if (this.activeRun) this.closePendingTools(this.activeRun, true);
    this.activeRun?.finish({ reason: 'session-disposed', scope: this.activeRun.scope(), type: 'cancelled' });
    this.activeRun = null;
    this.snapshot = this.makeSnapshot('disposed');
    await this.kernel?.dispose();
    this.kernel = null;
    this.listeners.clear();
  }

  private async startRun(run: HermesExecutionRun, request: ProviderExecutionRequest): Promise<void> {
    try {
      let kernel = this.kernel;
      if (!kernel) {
        kernel = this.createKernel({
          config: this.config,
          getActiveTurnId: () => this.activeRun?.turnId ?? null,
          onClosed: error => {
            const activeRun = this.activeRun;
            if (this.kernel === kernel && activeRun) this.failRun(activeRun, error);
          },
          onNotification: notification => {
            const activeRun = this.activeRun;
            if (this.kernel === kernel && activeRun) this.handleNotification(activeRun, notification);
          },
          plugin: this.plugin,
          sessionInstanceId: this.sessionInstanceId,
        });
        this.kernel = kernel;
        await kernel.connect();
      }
      if (run.terminal || this.disposed) return;
      const native = await kernel.openSession(this.nativeSessionId ?? undefined);
      if (run.terminal || this.disposed) return;
      this.nativeSessionId = native.sessionId;
      await this.applyConfiguration(kernel, native, request, run);
      if (run.terminal || this.disposed) return;
      this.snapshot = this.makeSnapshot('executing');
      this.emitSnapshot(run);
      const normalizer = new AcpExecutionEventNormalizer({
        mapUsage: usage => buildHermesUsageInfo(
          usage,
          decodeHermesModelId(request.configuration.model ?? '') ?? undefined,
        ),
        scope: {
          executionId: run.executionId,
          kind: 'requested',
          sessionInstanceId: this.sessionInstanceId,
          turnId: run.turnId,
        },
      });
      this.normalizers.set(run, normalizer);
      const selectedModel = decodeHermesModelId(request.configuration.model ?? '')
          ?? undefined;
      if (!this.lastUsage) {
        const initialUsage = buildInitialHermesUsageInfo(selectedModel);
        this.lastUsage = initialUsage;
        run.queue.push({
          scope: run.scope(),
          type: 'usage_updated',
          usage: initialUsage,
        });
      }
      const prompt = buildHermesPrompt(request);
      reportResolvedTurnPrompt(request, getTextCharacters(prompt));
      const response = await kernel.prompt({
        prompt,
        sessionId: native.sessionId,
      });
      if (run.terminal) return;
      this.closePendingTools(run, response.stopReason === 'cancelled');
      if (response.stopReason === 'cancelled') {
        this.snapshot = this.makeSnapshot('idle');
        this.emitSnapshot(run);
        run.finish({ reason: 'cancelled', scope: run.scope(), type: 'cancelled' });
        this.activeRun = null;
        return;
      }
      if (response.usage) {
        const usage = buildHermesPromptUsageInfo(
          response.usage,
          decodeHermesModelId(request.configuration.model ?? '') ?? undefined,
          this.lastUsage?.contextWindow,
        );
        if (usage) {
          this.lastUsage = usage;
          run.queue.push({ scope: run.scope(), type: 'usage_updated', usage });
        }
      }
      this.acceptRun(run, response.userMessageId ?? undefined);
      this.snapshot = this.makeSnapshot('idle');
      this.emitSnapshot(run);
      run.finish({ reason: 'completed', scope: run.scope(), type: 'turn_completed' });
      this.activeRun = null;
    } catch (error) {
      this.failRun(run, error);
    }
  }

  private readonly normalizers = new WeakMap<HermesExecutionRun, AcpExecutionEventNormalizer>();

  private async applyConfiguration(
    kernel: HermesAcpSessionKernel,
    native: Awaited<ReturnType<HermesAcpSessionKernel['openSession']>>,
    request: ProviderExecutionRequest,
    run: HermesExecutionRun,
  ): Promise<void> {
    const modelId = request.configuration.model
      ? decodeHermesModelId(request.configuration.model)
      : null;
    if (!modelId) throw new Error('Select an enabled Hermes model before sending a message.');
    if (native.models?.currentModelId !== modelId) await kernel.setModel({ modelId, sessionId: native.sessionId });
    if (run.terminal || this.disposed) return;
    const requestedMode = request.configuration.permissionMode;
    const modeId = requestedMode === 'accept_edits' || requestedMode === 'dont_ask' ? requestedMode : 'default';
    await kernel.setMode({ modeId, sessionId: native.sessionId });
  }

  private handleNotification(run: HermesExecutionRun, notification: AcpSessionNotification): void {
    if (run.terminal || notification.sessionId !== this.nativeSessionId) return;
    // Session loading can replay old messages before this turn has been sent.
    const normalizer = this.normalizers.get(run);
    if (!normalizer) return;
    if (notification.update.sessionUpdate === 'tool_call'
      || notification.update.sessionUpdate === 'agent_message_chunk'
      || notification.update.sessionUpdate === 'agent_thought_chunk') this.acceptRun(run);
    // Hermes emits model text and reasoning in the next iteration, after its tool
    // batch has returned. Some versions omit the corresponding ACP completion.
    if (notification.update.sessionUpdate === 'agent_message_chunk'
      || notification.update.sessionUpdate === 'agent_thought_chunk') this.closePendingTools(run);
    const result = normalizer.normalize(notification.update);
    for (const event of result?.events ?? []) {
      if (event.type === 'tool_started' && event.toolScope.kind === 'main') run.pendingTools.set(event.toolCallId, event.toolScope);
      if (event.type === 'tool_completed') run.pendingTools.delete(event.toolCallId);
      if (event.type === 'usage_updated') {
        this.lastUsage = event.usage;
      }
      run.queue.push({ ...event, scope: run.scope() });
    }
  }

  private acceptRun(run: HermesExecutionRun, nativeUserMessageId?: string): void {
    if (run.accepted && !nativeUserMessageId) return;
    run.accepted = true;
    run.queue.push({ accepted: true, nativeUserMessageId, scope: run.scope(), type: 'turn_started' });
  }

  private closePendingTools(run: HermesExecutionRun, interrupted = false): void {
    for (const [toolCallId, toolScope] of run.pendingTools) {
      run.queue.push({ type: 'tool_completed', toolCallId, toolScope, scope: run.scope(),
        ...(interrupted ? { isError: true } : { outcomeUnknown: true }),
        content: t(interrupted ? 'settings.hermes.toolInterrupted' : 'settings.hermes.toolResultMissing') });
    }
    run.pendingTools.clear();
  }

  private cancelRun(run: HermesExecutionRun): void {
    if (this.activeRun !== run || run.terminal) return;
    const kernel = this.kernel;
    this.kernel = null;
    if (this.nativeSessionId) kernel?.cancel(this.nativeSessionId);
    void kernel?.dispose().catch(() => undefined);
    this.closePendingTools(run, true);
    this.snapshot = this.makeSnapshot('idle');
    this.emitSnapshot(run);
    run.finish({ reason: 'cancelled', scope: run.scope(), type: 'cancelled' });
    this.activeRun = null;
  }

  private failRun(run: HermesExecutionRun, error: unknown): void {
    if (run.terminal) return;
    const failedKernel = this.kernel;
    this.kernel = null;
    void failedKernel?.dispose().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    this.snapshot = {
      ...this.makeSnapshot('invalidated'),
      invalidation: { message, reason: 'provider-error', recoverable: true },
      status: 'invalidated',
    };
    this.closePendingTools(run, true);
    run.finish({ category: 'provider', message, recoverable: true, scope: run.scope(), type: 'execution_error' });
    this.activeRun = null;
  }

  private emitSnapshot(run: HermesExecutionRun): void {
    run.queue.push({ scope: run.scope(), snapshot: this.snapshot, type: 'session_state_changed' });
  }

  private makeSnapshot(status: ProviderSessionStatus): ProviderSessionSnapshot {
    const base = {
      providerId: this.providerId,
      providerSessionId: this.nativeSessionId ?? undefined,
      revision: Date.now(),
    };
    if (status === 'invalidated') {
      return { ...base, invalidation: { reason: 'provider-error', recoverable: true }, status };
    }
    return { ...base, status };
  }
}

const HERMES_SLASH_COMMAND_PATTERN = /^\/[A-Za-z][\w:.-]*(?:\s|$)/u;

export function buildHermesPrompt(request: ProviderExecutionRequest): AcpContentBlock[] {
  let text = request.input.filter(block => block.type === 'text').map(block => block.text).join('\n');
  // Hermes only runs a slash command when the prompt is the bare command;
  // appended note/file context turns it into an ordinary model prompt.
  const isSlashCommand = HERMES_SLASH_COMMAND_PATTERN.test(text);
  if (!isSlashCommand && request.context?.currentNote?.path) {
    text = appendCurrentNote(text, request.context.currentNote.path);
  }
  if (!isSlashCommand && request.context?.editorSelection) {
    text = appendEditorContext(text, request.context.editorSelection);
  }
  if (!isSlashCommand && request.context?.contextFiles?.length) {
    text = appendContextFiles(text, [...request.context.contextFiles]);
  }
  const blocks: AcpContentBlock[] = [{ type: 'text', text }];
  for (const block of request.input) {
    if (block.type === 'image' && block.image.data) {
      blocks.push({ type: 'image', data: block.image.data, mimeType: block.image.mediaType });
    }
  }
  return blocks;
}

function getTextCharacters(prompt: readonly AcpContentBlock[]): number {
  return prompt
    .filter((block): block is Extract<AcpContentBlock, { type: 'text' }> => block.type === 'text')
    .reduce((total, block) => total + block.text.length, 0);
}

export function buildHermesUsageInfo(usage: AcpUsageUpdate, model?: string) {
  return buildAcpUsageInfo({
    contextWindow: usage,
    model,
    promptUsage: null,
  });
}

export function buildHermesPromptUsageInfo(
  usage: AcpUsage,
  model?: string,
  fallbackContextWindow = 200_000,
): UsageInfo | null {
  return buildAcpUsageInfo({
    fallbackContextWindow,
    model,
    promptUsage: usage,
  });
}

export function buildInitialHermesUsageInfo(model?: string): UsageInfo {
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
