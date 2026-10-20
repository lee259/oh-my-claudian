import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type { Conversation, ImageAttachment } from '../../../core/types';
import type { ChatExecutionCoordinator } from '../execution/ChatExecutionCoordinator';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import type { ChatStateCallbacks } from '../state/types';
import type { TabControllers, TabHydrationState, TabLifecycleState, TabServices } from '../tabs/types';
import { RuntimeComposer } from './RuntimeComposer';
import { RuntimeContext } from './RuntimeContext';
import { RuntimeMessagePresentation } from './RuntimeMessagePresentation';
import type { RuntimePresentation } from './RuntimePresentation';
import { createEmptyPresentationUI } from './RuntimePresentation';

export interface ConversationRuntimeBinding {
  conversationId: string | null;
  draftModel: string | null;
  id: string;
  lifecycleState: TabLifecycleState;
  providerId: ProviderId;
}

export interface RuntimePresentationCallbacks extends ChatStateCallbacks {
  onWorkChanged?: () => void;
}

export class ConversationRuntime {
  private readonly listeners = new Set<() => void>();
  private readonly presentationCallbacks = new Map<string, { callbacks: RuntimePresentationCallbacks }>();
  presentation: RuntimePresentation | null = null;
  releaseRegistration: (() => void) | null = null;
  retainedImages: ImageAttachment[] = [];
  retainedQuotes: Array<{ id: string; text: string }> = [];
  retainedFileContext: { files: string[]; currentNoteSent: boolean; sessionStarted: boolean } | null = null;
  hydrationWork: Promise<void> | null = null;
  private historyRetryWork: Promise<void> | null = null;
  readonly emptyUI = createEmptyPresentationUI();
  hydrationState: TabHydrationState;
  readonly controllers: Pick<TabControllers, 'inputController' | 'streamController' | 'conversationController'> = {
    inputController: null, streamController: null, conversationController: null,
  };
  private subagents: SubagentManager | null = null;
  readonly services: TabServices = (() => {
    const resolveSubagents = () => this.subagents ??= new SubagentManager(() => undefined,
      ProviderRegistry.getTaskResultInterpreter(this.providerId));
    return {
      get subagentManager() { return resolveSubagents(); },
      instructionRefineService: null, titleGenerationService: null,
    };
  })();
  readonly context = new RuntimeContext();
  readonly composer = new RuntimeComposer();
  readonly messagePresentation = new RuntimeMessagePresentation();
  /** Per-runtime provider/model reasoning choices; committed settings seed future tabs. */
  readonly reasoningSelections = new Map<string, string>();
  readonly permissionSelections = new Map<ProviderId, string>();
  private stopping: Promise<void> | null = null;
  private activeTurnValue: Promise<void> | null = null;
  private backgroundWork: Promise<void> = Promise.resolve();
  private backgroundWorkCount = 0;
  private backgroundWorkPauseDepth = 0;
  private coordinator: ChatExecutionCoordinator | null = null;

  constructor(
    private readonly binding: ConversationRuntimeBinding,
    onWorkChanged?: () => void,
    readonly state: ChatState = new ChatState(),
  ) {
    this.hydrationState = binding.conversationId ? 'idle' : 'ready';
    this.presentationCallbacks.set('host', { callbacks: { ...state.callbacks, onWorkChanged } });
    state.callbacks = {
      onMessagesChanged: () => this.emit('onMessagesChanged'),
      onStreamingStateChanged: value => this.emit('onStreamingStateChanged', value),
      onRewindingStateChanged: value => this.emit('onRewindingStateChanged', value),
      onConversationChanged: value => {
        this.binding.conversationId = value;
        this.emit('onConversationChanged', value);
      },
      onUsageChanged: value => this.emit('onUsageChanged', value),
      onTodosChanged: value => this.emit('onTodosChanged', value),
      onAttentionChanged: value => this.emit('onAttentionChanged', value),
      onAutoScrollChanged: value => this.emit('onAutoScrollChanged', value),
    };
  }

  /** Retries only an explicitly incomplete idle projection; ordinary reattachment stays in memory. */
  retryIncompleteHistory(
    conversation: Conversation,
    load: () => Promise<Conversation | null>,
  ): Promise<void> {
    if (this.historyRetryWork) return this.historyRetryWork;
    if (this.hydrationState !== 'ready' || this.hasWork || this.conversationId !== conversation.id) {
      return Promise.resolve();
    }
    const history = ProviderRegistry.getConversationHistoryService(this.providerId);
    if (!history.needsConversationHistoryHydration?.(
      { ...conversation, messages: this.state.messages }, { projectionOnly: true },
    )) return Promise.resolve();
    const initialMessages = JSON.stringify(this.state.messages);
    const lifecycle = this.lifecycleState;
    const work = (async () => {
      let refreshed: Conversation | null;
      try { refreshed = await load(); } catch { return; }
      if (!refreshed || refreshed.id !== this.conversationId || refreshed.providerId !== this.providerId
        || this.hasWork || this.lifecycleState !== lifecycle || JSON.stringify(this.state.messages) !== initialMessages) return;
      this.state.messages = structuredClone(refreshed.messages);
    })();
    const pending = work.finally(() => { if (this.historyRetryWork === pending) this.historyRetryWork = null; });
    this.historyRetryWork = pending;
    this.hydrationWork = pending;
    return pending;
  }

  get isRunning(): boolean {
    return this.state.isStreaming || this.activeTurn !== null || this.hasBackgroundWork
      || (this.coordinator?.hasSessionWork ?? false);
  }

  get hasWork(): boolean {
    return this.isRunning || this.state.requiresAction || this.state.isRewinding
      || this.state.hasPendingConversationSave || !!this.state.pendingNewSessionPlan;
  }

  /** Cancels only this runtime; completion includes turn persistence. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const activeTurn = this.activeTurn;
    this.state.pendingNewSessionPlan = null;
    this.controllers.inputController?.cancelStreaming();
    const sessionStop = this.coordinator?.stopSessionWork(activeTurn);
    this.state.dismissInteractions('cancelled');
    this.stopping = (async () => {
      try {
        await activeTurn;
      } finally {
        await sessionStop;
        await this.awaitBackgroundWork();
        this.state.pendingNewSessionPlan = null;
      }
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  /** A deferred attention reporter retains only runtime identity and numeric UI revision. */
  captureReviewableSettlement(outcome?: 'completed' | 'error'): () => void {
    const stamp = {
      epoch: this.presentation?.epoch,
      revision: this.presentation?.getActivationRevision?.(),
      wasBackground: this.presentation?.isActive?.() !== true,
    };
    return () => {
      if (!this.presentation || (stamp.wasBackground
        && this.presentation.epoch === stamp.epoch
        && this.presentation.getActivationRevision?.() === stamp.revision)) {
        this.state.markReviewRequired(outcome);
      }
    };
  }

  captureMetadataContext(): void {
    const ui = this.presentation?.ui;
    if (!ui || this.hydrationState !== 'ready') return;
    const previous = this.context.snapshot;
    this.context.capture({
      currentNote: ui.fileContextManager ? ui.fileContextManager.getCurrentNotePath() ?? undefined : previous.currentNote,
      externalContextPaths: ui.externalContextSelector?.getExternalContexts() ?? previous.externalContextPaths,
      enabledMcpServers: ui.mcpServerSelector ? [...ui.mcpServerSelector.getEnabledServers()] : previous.enabledMcpServers,
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  bindPresentationCallbacks(key: string, callbacks: RuntimePresentationCallbacks): () => void {
    const binding = { callbacks };
    this.presentationCallbacks.set(key, binding);
    return () => { if (this.presentationCallbacks.get(key) === binding) this.presentationCallbacks.delete(key); };
  }

  private emit<K extends keyof RuntimePresentationCallbacks>(key: K, ...args: Parameters<NonNullable<RuntimePresentationCallbacks[K]>>): void {
    for (const binding of this.presentationCallbacks.values()) {
      const callback = binding.callbacks[key] as ((...values: typeof args) => void) | undefined;
      callback?.(...args);
    }
    for (const listener of this.listeners) listener();
  }

  get id(): string { return this.binding.id; }
  get lifecycleState(): TabLifecycleState { return this.binding.lifecycleState; }
  set lifecycleState(value: TabLifecycleState) { this.binding.lifecycleState = value; }
  get providerId(): ProviderId { return this.binding.providerId; }
  set providerId(value: ProviderId) { this.binding.providerId = value; }
  get conversationId(): string | null { return this.binding.conversationId; }
  set conversationId(value: string | null) { this.binding.conversationId = value; }
  get draftModel(): string | null { return this.binding.draftModel; }
  set draftModel(value: string | null) { this.binding.draftModel = value; }
  get executionCoordinator(): ChatExecutionCoordinator | null { return this.coordinator; }
  get activeTurn(): Promise<void> | null { return this.activeTurnValue; }
  get hasBackgroundWork(): boolean { return this.backgroundWorkCount > 0; }
  set activeTurn(value: Promise<void> | null) {
    const wasWorking = this.activeTurnValue !== null;
    this.activeTurnValue = value;
    if (wasWorking !== (value !== null)) this.emit('onWorkChanged');
    if (value === null) this.coordinator?.notifyMayCool();
  }

  setExecutionCoordinator(coordinator: ChatExecutionCoordinator | null): void {
    this.coordinator = coordinator;
  }

  async disposeExecutionCoordinator(): Promise<void> {
    const coordinator = this.coordinator;
    this.coordinator = null;
    await coordinator?.dispose();
  }

  disposeModels(): void {
    this.controllers.streamController?.dispose();
    this.subagents?.clear();
    this.state.response.reset();
  }

  enqueueBackgroundWork(work: () => Promise<void>): Promise<void> | null {
    if (this.backgroundWorkPauseDepth > 0) return null;

    this.backgroundWorkCount++;
    const pending = this.backgroundWork
      .catch(() => undefined)
      .then(work);
    this.backgroundWork = pending;
    this.emit('onWorkChanged');
    void pending.then(
      () => {
        this.backgroundWorkCount = Math.max(0, this.backgroundWorkCount - 1);
        this.emit('onWorkChanged');
      },
      () => {
        this.backgroundWorkCount = Math.max(0, this.backgroundWorkCount - 1);
        this.emit('onWorkChanged');
      },
    );
    return pending;
  }

  async awaitBackgroundWork(): Promise<void> {
    await this.backgroundWork.catch(() => undefined);
  }

  pauseBackgroundWork(): void {
    this.backgroundWorkPauseDepth++;
  }

  resumeBackgroundWork(): void {
    this.backgroundWorkPauseDepth = Math.max(0, this.backgroundWorkPauseDepth - 1);
  }
}
