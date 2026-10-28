import { Notice } from 'obsidian';

import type { ComposerInputElement } from '@/shared/components/ComposerInput';

import {
  detectBuiltInCommand,
} from '../../../core/commands/builtInCommands';
import type { ProviderExecutionEvent } from '../../../core/execution';
import { getConversationModelLabel } from '../../../core/providers/conversationModel';
import { stringifyDiagnosticError } from '../../../core/providers/ProviderDiagnostics';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type InstructionRefineService,
  type ProviderCapabilities,
  type ProviderId,
  type TitleGenerationService,
} from '../../../core/providers/types';
import { TOOL_EXIT_PLAN_MODE } from '../../../core/tools/toolNames';
import { projectTranscript } from '../../../core/transcript/TranscriptProjection';
import {
  type ApprovalDecision,
  type AskUserAnswers,
  type ChatMessage,
  type ExitPlanModeDecision,
  type ExitPlanModePresentationOptions,
  type StreamChunk,
  type ToolCallInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import { extractUserDisplayContent } from '../../../utils/context';
import { formatDurationMmSs } from '../../../utils/date';
import type { EditorSelectionContext } from '../../../utils/editor';
import type { FeatureHost } from '../../FeatureHost';
import { COMPLETION_FLAVOR_WORDS } from '../constants';
import {
  type ChatExecutionCoordinator,
  ChatExecutionPreHandoffError,
} from '../execution/ChatExecutionCoordinator';
import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { InlineExitPlanMode } from '../rendering/InlineExitPlanMode';
import { InlinePlanApproval, type PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import { setToolIcon, updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { RuntimeComposer } from '../sessions/RuntimeComposer';
import type { MessagePresentation } from '../sessions/RuntimeMessagePresentation';
import type { AsyncQuestionPrompts } from '../state/AsyncQuestionPrompts';
import type { ChatState } from '../state/ChatState';
import type { QueuedMessage } from '../state/types';
import type { ChatTurnRequest } from '../state/types';
import { dispatchComposerInputEvent } from '../ui/ComposerInputEvents';
import type { FileContextManager } from '../ui/FileContext';
import { FollowUpQueueView } from '../ui/FollowUpQueueView';
import type { ImageContextManager } from '../ui/ImageContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { InstructionModeManager } from '../ui/InstructionModeManager';
import type { StatusPanel } from '../ui/StatusPanel';
import type { BrowserSelectionController } from './BrowserSelectionController';
import { BuiltInCommandController } from './BuiltInCommandController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import { syncComposerAutoScroll } from './ComposerAutoScroll';
import { captureComposerDraft, mergeComposerDraftContent } from './ComposerDraft';
import type { ConversationController } from './ConversationController';
import { DeferredReviewableSettlement } from './DeferredReviewableSettlement';
import { InputContainerVisibility } from './InputContainerVisibility';
import { InstructionSubmissionController } from './InstructionSubmissionController';
import { formatSelectionQuote } from './MessageQuoteController';
import {
  type PendingProviderUserMessage,
  PendingSteerRegistry,
  type PendingSteerState,
} from './PendingSteerRegistry';
import {
  cloneChatTurnRequest,
  cloneQueuedMessage,
  createQueuedMessage,
  toQueuedChatTurn,
} from './QueuedTurn';
import { ResumeDropdownController } from './ResumeDropdownController';
import type { SelectionController } from './SelectionController';
import {
  providerOutputEventToStreamChunk,
  type StreamController,
} from './StreamController';
import {
  hasSuspiciousCommandText,
} from './suspiciousCommandText';
import { TurnCompletionCoordinator } from './TurnCompletionCoordinator';
import type { ActiveTurnOwner } from './TurnCoordinator';
import { TurnCoordinator } from './TurnCoordinator';
import { TurnSubmissionBuilder } from './TurnSubmissionBuilder';

const APPROVAL_OPTION_MAP: Record<string, ApprovalDecision> = {
  'Deny': 'deny',
  'Allow once': 'allow',
  'Always allow': 'allow-always',
};

interface ApprovalDecisionOption {
  label: string;
  description?: string;
  value: string;
  decision?: ApprovalDecision;
}

interface ApprovalCallbackOptions {
  decisionReason?: string;
  blockedPath?: string;
  agentID?: string;
  decisionOptions?: ApprovalDecisionOption[];
  additionalPermissions?: unknown;
}

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] =
  Object.entries(APPROVAL_OPTION_MAP).map(([label, decision]) => ({
    get label() {
      return t(decision === 'deny' ? 'chat.approval.deny' : decision === 'allow' ? 'chat.approval.allow' : 'chat.approval.always');
    },
    value: label,
    decision,
  }));

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface InputControllerDeps {
  plugin: FeatureHost;
  state: ChatState;
  renderer: MessagePresentation;
  streamController: StreamController;
  selectionController: Pick<SelectionController, 'getContext'>;
  browserSelectionController?: Pick<BrowserSelectionController, 'getContext'>;
  canvasSelectionController: Pick<CanvasSelectionController, 'getContext'>;
  conversationController: ConversationController;
  composer?: RuntimeComposer;
  getInputEl: () => ComposerInputElement | null;
  getQuotedMessageTexts?: () => string[];
  clearQuotedMessages?: () => void;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement | null;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getInstructionRefineService: () => InstructionRefineService | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getInputContainerEl: () => HTMLElement | null;
  generateId: () => string;
  getProviderSettings?: () => Record<string, unknown>;
  getAuxiliaryModel?: () => string | null;
  getExecutionCoordinator: () => ChatExecutionCoordinator | null;
  getSubagentManager: () => SubagentManager;
  /** Authoritative tab/conversation provider, independent of runtime lifecycle. */
  getTabProviderId?: () => ProviderId;
  /** Returns true if ready. */
  ensureExecutionInitialized?: () => Promise<boolean>;
  openConversation?: (conversationId: string) => Promise<void>;
  /** Lets the active layout replace in-place clear with its own New action. */
  handleNewConversationCommand?: () => Promise<boolean>;
  /** Lets the active layout start approved plan content in a separate conversation. */
  handleNewSessionPlan?: (planContent: string) => Promise<boolean>;
  onForkAll?: () => Promise<void>;
  /** Toggles the active provider's fast service tier when available. */
  toggleFastMode?: () => Promise<boolean>;
  restorePrePlanPermissionModeIfNeeded?: () => void | Promise<void>;
  /** Captures a review reporter when a terminal provider turn becomes visible. */
  captureReviewableSettlement?: (outcome?: 'completed' | 'error') => () => void;
  /** Opens provider diagnostics for failures before execution handoff. */
  onDiagnosticError?: (error: unknown) => void;
  /** Performs a lightweight provider check before starting a new turn. */
  preflightExecution?: () => Promise<Error | null>;
  onFollowUpStateChanged?: () => void;
  turnOwner?: ActiveTurnOwner;
}

export interface SendMessageOptions {
  answeringQuestionId?: string;
  deliveryMode?: 'queue' | 'steer';
  queuedInputId?: string;
  editorContextOverride?: EditorSelectionContext | null;
  browserContextOverride?: BrowserSelectionContext | null;
  canvasContextOverride?: CanvasSelectionContext | null;
  content?: string;
  displayContentOverride?: string;
  onDelivery?: (accepted: boolean) => void;
  images?: ChatMessage['images'];
  turnRequestOverride?: ChatTurnRequest;
}

export class InputController {
  private deps: InputControllerDeps;
  private detachInteractions: (() => void) | null = null;
  private queueView: FollowUpQueueView | null = null;
  private stopGeneration = 0;
  private pendingApprovalInline: InlineAskUserQuestion | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private readonly resumeDropdownController: ResumeDropdownController;
  private readonly inputContainerVisibility = new InputContainerVisibility();
  private readonly asyncQuestions: AsyncQuestionPrompts;
  private readonly deferredDeliveryCallbacks = new WeakSet<(accepted: boolean) => void>();
  private activeDelivery: ((accepted: boolean) => void) | undefined;
  private readonly pendingSteersByConversation: PendingSteerRegistry;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private pendingProviderUserMessages: PendingProviderUserMessage[] = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;
  private readonly deferredReviewableSettlement = new DeferredReviewableSettlement();
  private preparingTurn = false;
  private readonly turnCoordinator: TurnCoordinator<SendMessageOptions>;
  private stoppedTurn: Promise<void> | null = null;
  private readonly turnSubmissionBuilder: TurnSubmissionBuilder;
  private readonly instructionSubmissionController: InstructionSubmissionController;
  private readonly builtInCommandController: BuiltInCommandController;
  private readonly turnCompletionCoordinator: TurnCompletionCoordinator;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
    this.asyncQuestions = deps.state.bindAsyncQuestionPrompts({
      showQuestion: (tool, signal, onSubmit) => this.showAsyncQuestion(tool, signal, onSubmit),
      answer: (tool, answers, conversationId) => this.answerAsyncQuestion(tool, answers, conversationId),
      onChange: tool => updateToolCallResult(tool.id, tool, this.deps.state.toolCallElements),
      onPendingChange: (id, pending) => pending
        ? this.deps.state.beginActionRequired(id)
        : this.deps.state.endActionRequired(id),
      getConversationId: () => this.deps.state.currentConversationId,
    });
    this.turnCoordinator = new TurnCoordinator(
      (options) => this.executeSendMessage(options),
      deps.turnOwner,
    );
    this.pendingSteersByConversation = new PendingSteerRegistry((conversationId) => {
      if (conversationId === this.deps.state.currentConversationId) {
        this.updateQueueIndicator();
      }
    });
    this.turnSubmissionBuilder = new TurnSubmissionBuilder({
      plugin: deps.plugin,
      state: deps.state,
      selectionController: deps.selectionController,
      browserSelectionController: deps.browserSelectionController,
      canvasSelectionController: deps.canvasSelectionController,
      getFileContextManager: deps.getFileContextManager,
      getMcpServerSelector: deps.getMcpServerSelector,
      getExternalContextSelector: deps.getExternalContextSelector,
      getProviderId: () => this.getActiveProviderId(),
      getProviderSettings: deps.getProviderSettings,
      getProviderCapabilities: () => this.getActiveCapabilities(),
      getAuxiliaryModel: () => this.getAuxiliaryModel(),
      generateId: deps.generateId,
    });
    this.instructionSubmissionController = new InstructionSubmissionController({
      plugin: deps.plugin,
      getInstructionRefineService: deps.getInstructionRefineService,
      getInstructionModeManager: deps.getInstructionModeManager,
      getModelOverride: () => this.getAuxiliaryModel(),
      ensureExecutionInitialized: deps.ensureExecutionInitialized,
    });
    this.resumeDropdownController = new ResumeDropdownController({
      plugin: deps.plugin,
      conversationController: deps.conversationController,
      getInputContainerEl: deps.getInputContainerEl,
      getInputEl: deps.getInputEl,
      getCurrentConversationId: () => deps.state.currentConversationId,
      openConversation: deps.openConversation,
    });
    this.builtInCommandController = new BuiltInCommandController({
      getCapabilities: () => this.getActiveCapabilities(),
      createNewConversation: () => deps.conversationController.createNew(),
      handleNewConversationCommand: deps.handleNewConversationCommand,
      getExternalContextSelector: deps.getExternalContextSelector,
      showResumeDropdown: () => this.resumeDropdownController.show(),
      onForkAll: deps.onForkAll,
      toggleFastMode: deps.toggleFastMode,
    });
    this.turnCompletionCoordinator = new TurnCompletionCoordinator({
      state: deps.state,
      requestPlanApproval: () => this.showPlanApproval(),
      restorePrePlanPermissionModeIfNeeded: () => deps.restorePrePlanPermissionModeIfNeeded?.(),
      saveConversation: async (didEnqueueToSdk) => {
        const saveExtras = didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
        try {
          await deps.conversationController.save(true, saveExtras);
        } catch (error) {
          if (deps.state.followUps.next) deps.state.followUps.pause();
          throw error;
        }
      },
      refreshActionButtons: (userMessage) => {
        const userMessageIndex = deps.state.messages.indexOf(userMessage);
        deps.renderer.refreshActionButtons(
          userMessage,
          deps.state.messages,
          userMessageIndex >= 0 ? userMessageIndex : undefined,
        );
      },
      setComposerText: (text) => {
        const inputEl = this.getComposer();
        inputEl.value = text;
        dispatchComposerInputEvent(inputEl);
      },
      scheduleCurrentControllerContinuation: (content, reporter) => {
        const inputEl = this.getComposer();
        inputEl.value = content;
        dispatchComposerInputEvent(inputEl);
        this.deferReviewableSettlement(reporter);
        const conversationId = deps.state.currentConversationId;
        const stopGeneration = this.stopGeneration;
        const streamGeneration = deps.state.streamGeneration;
        window.setTimeout(() => {
          if (deps.state.currentConversationId !== conversationId
            || this.stopGeneration !== stopGeneration
            || deps.state.streamGeneration !== streamGeneration) return;
          if (this.getComposer().value === content) {
            this.getComposer().value = '';
            dispatchComposerInputEvent(this.getComposer());
          }
          this.sendMessage({ content }).catch(() => this.reportDeferredReviewableSettlement());
        }, 0);
      },
      startNewConversation: () => deps.conversationController.createNew(),
      handleNewSessionPlan: async (content) => await deps.handleNewSessionPlan?.(content) ?? false,
      processQueuedMessage: () => this.processQueuedMessage(),
    });
    this.attachInteractionPresentation();
  }

  /** Rebuilds pending prompts from the model when presentation becomes available. */
  attachInteractionPresentation(): void {
    this.detachInteractionPresentation();
    if (!this.deps.getInputContainerEl()?.parentElement) return;
    this.detachInteractions = this.deps.state.interactions.attachPresentation({
      requestApproval: async (request, signal) => ({
        interactionId: request.interactionId,
        decision: await this.handleApprovalRequest(request.toolName, { ...request.input }, request.description, {
          decisionReason: request.decisionReason, blockedPath: request.blockedPath,
          decisionOptions: request.decisionOptions?.map(option => ({ ...option })),
          additionalPermissions: request.additionalPermissions,
        }, signal),
      }),
      askUserQuestion: async (request, signal) => ({
        interactionId: request.interactionId,
        answers: await this.handleAskUserQuestion({ ...request.input }, signal),
      }),
      requestPlanDecision: async (request, signal) => ({
        interactionId: request.interactionId,
        decision: await this.handleExitPlanMode({ ...request.input }, signal, request.presentation),
      }),
      requestAsyncQuestion: async (request, signal) => ({
        interactionId: request.interactionId,
        answers: await this.renderAsyncQuestion(request.input, signal, request.onSubmit),
      }),
      requestLocalPlanApproval: async (request, signal) => ({
        interactionId: request.interactionId,
        decision: await this.renderPlanApproval(signal),
        invalidated: false,
      }),
      dismissInteraction: (_id, reason) => {
        if (reason !== 'resolved') this.dismissProviderPrompts();
      },
    });
  }

  detachInteractionPresentation(): void {
    this.queueView?.destroy();
    this.queueView = null;
    this.detachInteractions?.();
    this.detachInteractions = null;
  }

  private dismissProviderPrompts(): void {
    this.dismissPendingApprovalPrompt();
    this.pendingAskInline?.destroy();
    this.pendingAskInline = null;
    this.pendingExitPlanModeInline?.destroy();
    this.pendingExitPlanModeInline = null;
    this.dismissPendingPlanApproval();
  }

  private getComposer(): ComposerInputElement | RuntimeComposer {
    const composer = this.deps.composer ?? this.deps.getInputEl();
    if (!composer) throw new Error('A runtime composer is required without presentation.');
    return composer;
  }

  private getExecutionCoordinator(): ChatExecutionCoordinator | null {
    return this.deps.getExecutionCoordinator();
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.() ?? null;
  }

  private getActiveProviderId(): ProviderId {
    const tabProviderId = this.deps.getTabProviderId?.();
    if (tabProviderId) {
      return tabProviderId;
    }

    const conversationId = this.deps.state.currentConversationId;
    if (!conversationId) {
      return DEFAULT_CHAT_PROVIDER_ID;
    }

    return this.deps.plugin.getConversationSync(conversationId)?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getActiveCapabilities(): ProviderCapabilities {
    const providerId = this.getActiveProviderId();
    return ProviderRegistry.getCapabilities(providerId);
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: SendMessageOptions): Promise<void> {
    if (!options?.onDelivery) {
      await this.submitMessage(options);
      return;
    }

    let settled = false;
    const onDelivery = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      options.onDelivery?.(accepted);
    };
    try {
      await this.submitMessage({ ...options, onDelivery });
      if (!settled && !this.deferredDeliveryCallbacks.has(onDelivery)) onDelivery(false);
    } catch (error) {
      onDelivery(false);
      throw error;
    }
  }

  private submitMessage(options?: SendMessageOptions): Promise<void> {
    // The composer still contains the reserved draft until readiness completes.
    if (this.preparingTurn && options?.content === undefined) return Promise.resolve();
    // Follow-ups must not replace the runtime's active execution/drain owner.
    return this.turnCoordinator.current || this.deps.state.isStreaming
      ? this.executeSendMessage(options) : this.turnCoordinator.run(options);
  }

  async handleExecutionEvent(event: ProviderExecutionEvent): Promise<void> {
    if (event.type === 'turn_started' && event.accepted) this.activeDelivery?.(true);
    if (event.type === 'usage_updated') {
      this.deps.streamController.updateUsage(event.usage);
      return;
    }
    const assistant = this.activeStreamingAssistantMessage;
    if (!assistant) return;
    if (event.scope?.kind === 'requested') {
      this.deps.renderer.setTranscriptExecutionScope?.(assistant.id, {
        executionId: event.scope.executionId,
        turnId: event.scope.turnId,
      });
    }
    if (event.type === 'turn_completed') {
      this.deps.state.cancelRequested = false;
      assistant.turnStats = event.turnStats;
      return;
    }
    if (event.type === 'user_message_started') {
      await this.handleProviderMessageBoundaryChunk({
        content: event.content ?? '',
        itemId: event.nativeUserMessageId,
        type: 'user_message_start',
      });
      return;
    }
    if (event.type === 'assistant_message_started') {
      await this.handleProviderMessageBoundaryChunk({
        itemId: event.nativeAssistantId,
        type: 'assistant_message_start',
      });
      return;
    }
    const chunk = providerOutputEventToStreamChunk(event);
    if (chunk) {
      await this.deps.streamController.handleStreamChunk(
        chunk,
        this.activeStreamingAssistantMessage ?? assistant,
      );
    }
  }

  private async executeSendMessage(options?: SendMessageOptions): Promise<void> {
    const {
      state,
      renderer,
      streamController,
    } = this.deps;
    const isFollowUp = state.isStreaming || this.turnCoordinator.current !== null;
    const followsStop = this.stoppedTurn !== null && this.turnCoordinator.current === this.stoppedTurn;
    let editedMessage: QueuedMessage | null = null;
    const restoreUnsentMessage = (message: QueuedMessage, restoreOptions: { mergeWithComposer?: boolean } = {}) => {
      if (!options?.queuedInputId) {
        if (editedMessage) state.followUps.restoreEditingContext({ ...message, onDelivery: editedMessage.onDelivery });
        this.restoreMessageToInput(message, restoreOptions);
      }
    };
    this.discardDeferredReviewForDifferentConversation();

    // During conversation creation/switching, don't send - input is preserved so user can retry
    if (state.isCreatingConversation || state.isSwitchingConversation) {
      this.reportDeferredReviewableSettlement();
      return;
    }

    const inputEl = this.getComposer();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    const rawContent = (contentOverride ?? inputEl.value).trim();
    const quotedMessageTexts = shouldUseInput ? this.deps.getQuotedMessageTexts?.() ?? [] : [];
    const formattedQuotes = quotedMessageTexts.map(formatSelectionQuote).join('\n\n');
    const content = formattedQuotes
      ? `${formattedQuotes}\n\n${rawContent}`.trim()
      : rawContent;
    const imageOverride = options?.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : (imageContextManager?.hasImages() ?? false);
    if (!content && !hasImages && !options?.turnRequestOverride?.text.trim()) {
      this.reportDeferredReviewableSettlement();
      return;
    }

    if (state.isRewinding) {
      new Notice(t('chat.rewind.inProgress'));
      this.reportDeferredReviewableSettlement();
      return;
    }

    editedMessage = shouldUseInput ? state.followUps.editingMessage : null;
    if (editedMessage && !options?.turnRequestOverride) {
      options = {
        ...options,
        displayContentOverride: content,
        turnRequestOverride: this.buildEditedRequest(editedMessage, content,
          imageOverride ?? imageContextManager?.getAttachedImages() ?? []),
        onDelivery: options?.onDelivery ?? editedMessage.onDelivery,
      };
    }

    // Check for built-in commands first (e.g., /clear, /new, /add-dir)
    const builtInCmd = detectBuiltInCommand(content, this.getActiveProviderId());
    if (builtInCmd) {
      if (builtInCmd.command.action === 'clear') {
        this.clearDeferredReviewableSettlement();
      } else {
        this.reportDeferredReviewableSettlement();
      }
      if (shouldUseInput) {
        state.followUps.finishEditing(editedMessage);
        editedMessage?.onDelivery?.(false);
        inputEl.value = '';
        dispatchComposerInputEvent(inputEl);
      }
      await this.builtInCommandController.execute(builtInCmd.command, builtInCmd.args);
      return;
    }

    // Snapshot follow-ups immediately; provider readiness is checked when they execute.
    if (state.isStreaming || isFollowUp) {
      const itemId = this.queueStreamingMessage(content, imageOverride, hasImages, shouldUseInput, options, followsStop);
      if (shouldUseInput && quotedMessageTexts.length > 0) this.deps.clearQuotedMessages?.();
      if (options?.deliveryMode === 'steer') await this.steerQueuedMessage(itemId);
      if (!state.isStreaming && !this.turnCoordinator.current) this.processQueuedMessage();
      return;
    }

    let streamGeneration: number;
    this.preparingTurn = shouldUseInput;
    try {
      if (this.deps.preflightExecution) {
        const preflightError = await this.deps.preflightExecution();
        if (preflightError) {
          this.deps.onDiagnosticError?.(preflightError);
          this.reportDeferredReviewableSettlement();
          return;
        }
      }
      if (this.deps.conversationController.hasBranchPreview
        && !await this.deps.conversationController.commitBranchPreview()) {
        this.reportDeferredReviewableSettlement();
        return;
      }
      if (shouldUseInput) state.followUps.finishEditing(editedMessage);
      streamGeneration = this.beginTurn(
        shouldUseInput,
        fileContextManager,
      );
    } finally {
      this.preparingTurn = false;
    }
    if (shouldUseInput && quotedMessageTexts.length > 0) this.deps.clearQuotedMessages?.();

    // Slash commands are passed directly to SDK for handling
    // SDK handles expansion, $ARGUMENTS, @file references, and frontmatter options
    const images = imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
    const isCompact = /^\/compact(\s|$)/i.test(content);

    // Only clear images if we consumed user input (not for programmatic content override)
    if (shouldUseInput) {
      imageContextManager?.clearImages();
    }

    const turnSubmission = options?.turnRequestOverride
      ? {
        displayContent: options.displayContentOverride ?? content,
        turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
      }
      : this.turnSubmissionBuilder.buildRequest({
        content,
        images: imagesForMessage,
        editorContextOverride: options?.editorContextOverride,
        browserContextOverride: options?.browserContextOverride,
        canvasContextOverride: options?.canvasContextOverride,
      });
    const { displayContent, turnRequest } = turnSubmission;
    const messagesBeforeTurn = state.messages;
    const hadPendingConversationSave = state.hasPendingConversationSave;

    fileContextManager?.markCurrentNoteSent();

    const userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content: displayContent,
      displayContent,                // Original user input (for UI display)
      timestamp: Date.now(),
      images: imagesForMessage,
    };
    state.addMessage(userMsg);
    state.hasPendingConversationSave = true;
    renderer.addMessage(userMsg);

    try {
      await this.triggerTitleGeneration();
    } catch (error) {
      restoreUnsentMessage(createQueuedMessage(displayContent, turnRequest), { mergeWithComposer: true });
      this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
      throw error;
    }
    if (state.cancelRequested) {
      restoreUnsentMessage(createQueuedMessage(displayContent, turnRequest), {
        mergeWithComposer: true,
      });
      this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
      this.resetProviderMessageBoundaryState();
      this.reportDeferredReviewableSettlement();
      return;
    }
    const turnConversationId = state.currentConversationId;

    const assistantMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      modelName: getConversationModelLabel(
        turnConversationId
          ? this.deps.plugin.getConversationSync(turnConversationId)
          : null,
        this.deps.plugin.settings,
      ),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    this.activeStreamingAssistantMessage = assistantMsg;
    this.activateStreamingAssistantMessage(assistantMsg);
    this.pendingProviderUserMessages = [{
      displayContent,
      images: imagesForMessage,
    }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'claudian-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();

    let wasInterrupted = false;
    let wasInvalidated = false;
    let didEnqueueToSdk = false;
    let planCompleted = false;
    let didRollbackUnsentTurn = false;
    let shouldReportReviewableSettlement = false;
    let currentReviewableSettlementReporter: (() => void) | null = null;
    let didCancelThisTurn = false;
    let hadExecutionError = false;
    let planApprovalInvalidated = false;
    let scheduledContinuation = false;
    let continuationStaysInCurrentController = false;

    // Lazy initialization: bind and prepare execution on the first provider action.
    if (this.deps.ensureExecutionInitialized) {
      const ready = await this.deps.ensureExecutionInitialized();
      if (state.cancelRequested) {
        restoreUnsentMessage(createQueuedMessage(displayContent, turnRequest), {
          mergeWithComposer: true,
        });
        this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        this.reportDeferredReviewableSettlement();
        return;
      }
      if (!ready) {
        new Notice(t('chat.errors.initializeExecution'));
        restoreUnsentMessage(createQueuedMessage(displayContent, turnRequest));
        this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        this.reportDeferredReviewableSettlement();
        return;
      }
    }

    const coordinator = this.getExecutionCoordinator();
    if (!coordinator) {
      new Notice(t('chat.errors.executionUnavailable'));
      restoreUnsentMessage(createQueuedMessage(displayContent, turnRequest));
      this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      this.reportDeferredReviewableSettlement();
      return;
    }

    try {
      userMsg.content = turnRequest.text;
      userMsg.currentNote = isCompact ? undefined : turnRequest.currentNotePath;
      this.activeDelivery = options?.onDelivery;
      const result = await coordinator.execute(this.turnSubmissionBuilder.buildExecutionSubmission(
        displayContent,
        turnRequest,
        userMsg,
        assistantMsg,
      ));
      if (result.accepted) options?.onDelivery?.(true);
      didEnqueueToSdk = result.accepted;
      planCompleted = result.planCompleted;
      if (isCompact && result.status === 'completed') {
        const compactMessage = this.activeStreamingAssistantMessage ?? assistantMsg;
        const hasCompactBoundary = compactMessage.contentBlocks?.some(
          block => block.type === 'context_compacted',
        ) === true;
        const hasCompactOutput = compactMessage.content.trim().length > 0
          || this.deps.state.currentTextContent.trim().length > 0
          || (compactMessage.toolCalls?.length ?? 0) > 0;
        if (!hasCompactBoundary && !hasCompactOutput) {
          hadExecutionError = true;
          await streamController.appendText(
            '\n\n**Error:** Compaction finished without a confirmation. Please try again.',
          );
        }
      }
      shouldReportReviewableSettlement = result.status === 'completed'
        || (result.status === 'error' && result.accepted);
      if (shouldReportReviewableSettlement) {
        currentReviewableSettlementReporter =
          this.deps.captureReviewableSettlement?.(
            result.status === 'error' ? 'error' : 'completed',
          ) ?? null;
      }
      if (result.status === 'cancelled') {
        this.asyncQuestions.expireAll();
        wasInterrupted = true;
      } else if (result.status === 'invalidated') {
        this.asyncQuestions.expireAll();
        wasInvalidated = true;
      } else if (result.status === 'missing-session') {
        this.asyncQuestions.expireAll();
        this.handleMissingSessionResult(
          result,
          displayContent,
          turnRequest,
          imagesForMessage,
          messagesBeforeTurn,
          hadPendingConversationSave,
          streamGeneration,
          options?.queuedInputId !== undefined,
        );
        wasInvalidated = true;
      } else if (result.status === 'error') {
        hadExecutionError = true;
        if (result.error) await streamController.appendText(`\n\n**Error:** ${result.error.message}`);
      }
    } catch (error) {
      if (error instanceof ChatExecutionPreHandoffError) {
        restoreUnsentMessage(
          createQueuedMessage(displayContent, turnRequest),
          { mergeWithComposer: true },
        );
        this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
        didRollbackUnsentTurn = true;
        new Notice(t('chat.errors.notSent'));
        this.deps.onDiagnosticError?.(error);
        this.reportDeferredReviewableSettlement();
      } else {
        if (options?.queuedInputId) {
          state.followUps.setStatus(options.queuedInputId, 'uncertain');
          state.followUps.pause();
        }
        hadExecutionError = true;
        shouldReportReviewableSettlement = true;
        const errorMsg = stringifyDiagnosticError(error);
        await streamController.appendText(`\n\n**Error:** ${errorMsg}`);
        currentReviewableSettlementReporter =
          this.deps.captureReviewableSettlement?.('error') ?? null;
      }
    } finally {
      if (this.activeDelivery === options?.onDelivery) this.activeDelivery = undefined;
      const finalAssistantMsg = this.activeStreamingAssistantMessage ?? assistantMsg;

      // ALWAYS clear the timer interval, even on stream invalidation (prevents memory leaks)
      state.clearFlavorTimerInterval();

      try {
        // Skip remaining cleanup if stream was invalidated (tab closed or conversation switched)
        if (
          !wasInvalidated
          && !didRollbackUnsentTurn
          && state.streamGeneration === streamGeneration
        ) {
          didCancelThisTurn = wasInterrupted || state.cancelRequested;
          if (didCancelThisTurn && !state.pendingNewSessionPlan) {
            finalAssistantMsg.isInterrupt = true;
            if (state.currentContentEl) {
              renderer.appendInterruptIndicator(state.currentContentEl);
            }
          }
          this.finishStreamingState(streamController);
          // Compaction continues the turn, so its time belongs to the completed response.
          if (!didCancelThisTurn && !hadExecutionError) {
            const durationSeconds = state.responseStartTime
              ? Math.floor((performance.now() - state.responseStartTime) / 1000)
              : 0;
            if (durationSeconds > 0) {
              const flavorWord =
                COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
              finalAssistantMsg.durationSeconds = durationSeconds;
              finalAssistantMsg.durationFlavorWord = flavorWord;
              // Add footer to live message in DOM
              if (state.currentContentEl) {
                const footerEl = state.currentContentEl.createDiv({ cls: 'claudian-response-footer' });
                footerEl.createSpan({
                  text: `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`,
                  cls: 'claudian-baked-duration',
                });
              }
            }
          }

          if (didCancelThisTurn || hadExecutionError) {
            for (const tool of finalAssistantMsg.toolCalls ?? []) {
              if (tool.status === 'running' && tool.startedAt !== undefined && tool.completedAt === undefined) {
                tool.completedAt = Date.now();
              }
            }
          }

          await this.finalizeRenderedTurn(finalAssistantMsg);
          this.finalizeTranscriptTurn(finalAssistantMsg);

          // approve-new-session: the tool_result chunk is dropped because cancelRequested
          // was set before the stream loop could process it — manually set the result so
          // the saved conversation renders correctly when revisited
          if (state.pendingNewSessionPlan && finalAssistantMsg.toolCalls) {
            for (const tc of finalAssistantMsg.toolCalls) {
              if (tc.name === TOOL_EXIT_PLAN_MODE && !tc.result) {
                tc.status = 'completed';
                if (tc.startedAt !== undefined) tc.completedAt = Date.now();
                tc.result = 'User approved the plan and started a new session.';
                updateToolCallResult(tc.id, tc, state.toolCallElements);
              }
            }
          }

          if (didCancelThisTurn || hadExecutionError) state.followUps.pause();
          const completion = await this.turnCompletionCoordinator.complete({
            streamGeneration,
            didEnqueueToSdk,
            planCompleted,
            didCancelThisTurn,
            userMessage: userMsg,
            reviewableSettlementReporter: currentReviewableSettlementReporter,
          });
          planApprovalInvalidated = completion.planApprovalInvalidated;
          scheduledContinuation = completion.scheduledContinuation;
          continuationStaysInCurrentController = completion.continuationStaysInCurrentController;
        }

        if (wasInvalidated) {
          state.followUps.pause();
          this.pendingSteersByConversation.clearCurrentUi(state.currentConversationId);
          this.updateQueueIndicator();
        }
      } finally {
        const currentSettlementIsReviewable = shouldReportReviewableSettlement
          && !didCancelThisTurn
          && !planApprovalInvalidated
          && state.streamGeneration === streamGeneration;
        if (scheduledContinuation) {
          if (continuationStaysInCurrentController) {
            if (currentSettlementIsReviewable && currentReviewableSettlementReporter) {
              this.deferReviewableSettlement(currentReviewableSettlementReporter);
            }
          } else {
            this.clearDeferredReviewableSettlement();
          }
        } else if (currentSettlementIsReviewable) {
          this.reportCurrentOrDeferredReviewableSettlement(
            currentReviewableSettlementReporter,
          );
        } else {
          this.reportDeferredReviewableSettlement();
        }

        this.pendingSteersByConversation.delegateToHistory(turnConversationId);
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
      }
    }
  }

  private beginTurn(
    shouldUseInput: boolean,
    fileContextManager: FileContextManager | null,
  ): number {
    const { plugin, state } = this.deps;
    state.acknowledgeReview();
    const turnConversationId = state.currentConversationId;
    this.pendingSteersByConversation.delegateToHistory(turnConversationId);
    if (shouldUseInput) {
      const inputEl = this.getComposer();
      inputEl.value = '';
      dispatchComposerInputEvent(inputEl);
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false;
    this.deps.getSubagentManager().resetSpawnedCount();
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    const streamGeneration = state.bumpStreamGeneration();
    this.deps.getWelcomeEl()?.addClass('claudian-hidden');
    fileContextManager?.startSession();
    return streamGeneration;
  }

  private handleMissingSessionResult(
    result: Awaited<ReturnType<ChatExecutionCoordinator['execute']>>,
    displayContent: string,
    turnRequest: ChatTurnRequest,
    images: ChatMessage['images'] | undefined,
    messagesBeforeTurn: ChatMessage[],
    hadPendingConversationSave: boolean,
    streamGeneration: number,
    preserveQueuedInput = false,
  ): void {
    const retryMessage = result.accepted || preserveQueuedInput
      ? null
      : createQueuedMessage(displayContent, { ...turnRequest, images: images ?? turnRequest.images });
    this.deps.state.followUps.pause();
    const draft = this.captureComposerDraft();
    const resolution = result.missingSessionResolution ?? 'not_found';
    if (resolution === 'deleted') {
      this.restoreMessageToInput(draft, { mergeWithComposer: true });
      this.restoreMessageToInput(retryMessage, { mergeWithComposer: true });
    } else if (retryMessage) {
      this.restoreMessageToInput(retryMessage, { mergeWithComposer: true });
      this.rollbackFailedTurn(messagesBeforeTurn, hadPendingConversationSave);
    }
    if (result.accepted) this.finishAcceptedMissingSession(streamGeneration);
    const notices: Record<string, string> = {
      deleted: 'The provider session no longer exists. Its Oh My Claudian record was removed; send again to start a new session.',
      preserved: 'The provider session no longer exists. Oh My Claudian preserved its record because the remaining history could not be verified.',
      reset: 'The provider session no longer exists. Oh My Claudian preserved the recoverable history; send again to rebuild the session.',
    };
    new Notice(notices[resolution] ?? 'The provider session no longer exists. Send again to start a new session.');
  }

  private finishStreamingState(streamController: StreamController): void {
    streamController.hideThinkingIndicator();
    this.deps.state.isStreaming = false;
    this.deps.state.cancelRequested = false;
  }

  private async finalizeRenderedTurn(message: ChatMessage): Promise<void> {
    const { renderer, state, streamController } = this.deps;
    const messageEl = state.currentContentEl?.closest<HTMLElement>('.claudian-message') ?? null;
    streamController.flushPendingTools();
    state.currentContentEl = null;
    await streamController.finalizeCurrentThinkingBlock(message);
    await streamController.finalizeCurrentTextBlock(message);
    renderer.renderFinalMessageTimestamp?.(messageEl, message);
    this.deps.getSubagentManager().resetStreamingState(new Set(message.toolCalls?.map(tool => tool.id)));
    state.response.reset();
    if (state.currentTodos?.every(todo => todo.status === 'completed')) state.currentTodos = null;
    this.syncScrollToBottomAfterRenderUpdates();
  }

  private finalizeTranscriptTurn(message: ChatMessage): void {
    const { renderer, state } = this.deps;
    const turn = projectTranscript(state.messages).find((candidate) =>
      candidate.runs.some((run) => run.messageId === message.id),
    );
    if (turn && renderer.finalizeTranscriptTurn) {
      renderer.finalizeTranscriptTurn(turn, message.id);
      return;
    }
    const runIds = new Set(turn?.runs.map((run) => run.messageId) ?? [message.id]);
    const runs = state.messages.filter((candidate) =>
      candidate.role === 'assistant' && runIds.has(candidate.id),
    );
    for (const run of runs) renderer.finalizeCompletedWork?.(run, run.id === message.id);
  }

  private queueStreamingMessage(
    content: string,
    imageOverride: ChatMessage['images'] | undefined,
    hasImages: boolean,
    shouldUseInput: boolean,
    options?: SendMessageOptions,
    priority = false,
  ): string {
    const { state } = this.deps;
    const editingMessage = shouldUseInput ? state.followUps.editingMessage : null;
    const imageContextManager = this.deps.getImageContextManager();
    const images = hasImages
      ? [...(imageOverride ?? imageContextManager?.getAttachedImages() ?? [])]
      : undefined;
    const built = this.turnSubmissionBuilder.buildRequest({
      content,
      images,
      editorContextOverride: this.deps.selectionController.getContext(),
      browserContextOverride: this.deps.browserSelectionController?.getContext() ?? null,
      canvasContextOverride: this.deps.canvasSelectionController.getContext(),
    });
    const displayContent = options?.displayContentOverride ?? built.displayContent;
    const turnRequest = options?.turnRequestOverride
      ? cloneChatTurnRequest(options.turnRequestOverride)
      : editingMessage ? this.buildEditedRequest(editingMessage, content, images ?? []) : built.turnRequest;
    const queued = createQueuedMessage(displayContent, turnRequest);
    queued.answeringQuestionId = options?.answeringQuestionId;
    const onDelivery = options?.onDelivery ?? editingMessage?.onDelivery;
    if (onDelivery) {
      queued.onDelivery = onDelivery;
      this.deferredDeliveryCallbacks.add(onDelivery);
    }
    const itemId = this.deps.generateId();
    if (priority || queued.answeringQuestionId) state.followUps.enqueuePriority(itemId, queued);
    else state.followUps.enqueue(itemId, queued);
    if (shouldUseInput) state.followUps.finishEditing(editingMessage);
    if (shouldUseInput) {
      const inputEl = this.getComposer();
      inputEl.value = '';
      dispatchComposerInputEvent(inputEl);
      imageContextManager?.clearImages();
    }
    this.updateQueueIndicator();
    return itemId;
  }

  // ============================================
  // Queue Management
  // ============================================

  updateQueueIndicator(): void {
    const { state } = this.deps;
    const root = state.queueIndicatorEl;
    if (this.queueView?.root !== root) {
      this.queueView?.destroy();
      this.queueView = root ? new FollowUpQueueView(root, state.followUps, {
        onSteer: id => { void this.steerQueuedMessage(id); },
        onRemove: id => this.clearQueuedMessage(id),
        onResume: () => this.resumeQueuedMessages(),
        onEdit: id => this.editQueuedMessage(id),
      }) : null;
    }
    this.deps.onFollowUpStateChanged?.();
    this.queueView?.update(this.canSteerFollowUp(),
      !state.isStreaming ? t('chat.followUp.idle')
        : this.getActiveCapabilities().supportsTurnSteer
          ? t('chat.followUp.waiting') : t('chat.followUp.unsupported'), !state.isStreaming);
  }

  private buildEditedRequest(message: QueuedMessage, content: string, images: NonNullable<ChatMessage['images']>): ChatTurnRequest {
    const request = cloneChatTurnRequest(toQueuedChatTurn(message).request);
    request.text = /^\/compact(\s|$)/i.test(content) ? content
      : this.deps.getFileContextManager()?.transformContextMentions(content) ?? content;
    request.images = [...images];
    return request;
  }

  editQueuedMessage(id: string): void {
    const { state } = this.deps;
    if (!state.followUps.items.some(item => item.id === id && item.status === 'queued')) return;
    if (this.turnCoordinator.current && !state.isStreaming) return;
    const input = this.getComposer();
    const images = this.deps.getImageContextManager()?.getAttachedImages() ?? [];
    const quotes = this.deps.getQuotedMessageTexts?.() ?? [];
    const draft = [...quotes.map(formatSelectionQuote), input.value].filter(Boolean).join('\n\n');
    if (draft.trim() || images.length || state.followUps.editingMessage) {
      this.queueStreamingMessage(draft || state.followUps.editingMessage?.content || '', images, !!images.length, true);
    }
    this.deps.clearQuotedMessages?.();
    const message = state.followUps.withdrawForEditing(id);
    if (!message) return;
    this.restoreMessageToInput({ ...message, onDelivery: undefined });
    this.updateQueueIndicator();
  }

  clearQueuedMessage(itemId?: string): void {
    const queue = this.deps.state.followUps;
    if (itemId === undefined) {
      const unsent = queue.items.filter(item => item.status === 'queued').map(item => item.message);
      if (queue.editingMessage) unsent.push(queue.editingMessage);
      queue.clear();
      for (const message of unsent) message.onDelivery?.(false);
      this.updateQueueIndicator();
      return;
    }
    const item = queue.items.find(entry => entry.id === itemId);
    if (!item || item.status !== 'queued') return;
    item.message.onDelivery?.(false);
    queue.remove(item.id);
    this.updateQueueIndicator();
  }

  restoreRewoundMessageToComposer(
    message: Pick<ChatMessage, 'content' | 'images'>,
  ): void {
    this.restoreMessageToInput({
      canvasContext: null,
      content: message.content,
      editorContext: null,
      images: message.images,
    });
    const inputEl = this.getComposer();
    dispatchComposerInputEvent(inputEl);
  }

  private restoreMessageToInput(
    message: QueuedMessage | null,
    options: { mergeWithComposer?: boolean } = {},
  ): void {
    if (!message) return;
    message.onDelivery?.(false);

    const { content, images } = message;
    const inputEl = this.getComposer();
    const currentContent = options.mergeWithComposer ? inputEl.value : '';
    inputEl.value = mergeComposerDraftContent(content, currentContent);
    dispatchComposerInputEvent(inputEl);

    const imageContextManager = this.deps.getImageContextManager();
    const currentImages = options.mergeWithComposer
      ? (imageContextManager?.getAttachedImages() ?? [])
      : [];
    const restoredImages = [...(images ?? []), ...currentImages];
    if (imageContextManager && (!options.mergeWithComposer || restoredImages.length > 0)) {
      imageContextManager.setImages(restoredImages);
    }
    inputEl.focus();
  }

  private captureComposerDraft(): QueuedMessage | null {
    const content = this.getComposer().value;
    const attachedImages = this.deps.getImageContextManager()?.getAttachedImages() ?? [];
    const images = attachedImages.length > 0 ? [...attachedImages] : undefined;
    return captureComposerDraft(content, images);
  }

  private processQueuedMessage(): boolean {
    const { state } = this.deps;
    if (state.isStreaming) return false;
    // A pending question must not block delivery of its own answer.
    const answer = state.followUps.takeNextPriority(candidate => {
      const questionId = candidate.message.answeringQuestionId;
      return questionId !== undefined && state.messages.some(message => message.toolCalls?.some(tool =>
        tool.id === questionId && tool.questionStatus === 'pending' && !tool.resolvedAnswers));
    });
    const item = answer ?? (state.requiresAction ? null : state.followUps.takeNextPriority() ?? state.followUps.takeNext());
    if (!item) return false;
    const conversationId = state.currentConversationId;
    const stopGeneration = this.stopGeneration;
    this.updateQueueIndicator();
    window.setTimeout(() => {
      if (this.stopGeneration !== stopGeneration || state.isStreaming || this.turnCoordinator.current
        || state.currentConversationId !== conversationId
        || (state.followUps.paused && !state.followUps.isPriority(item.id))
        || state.followUps.items.find(entry => entry.id === item.id)?.status !== 'sending') {
        state.followUps.setStatus(item.id, 'queued');
        this.updateQueueIndicator();
        return;
      }
      void this.sendMessage({
        answeringQuestionId: item.message.answeringQuestionId,
        content: item.message.content,
        queuedInputId: item.id,
        images: item.message.images,
        turnRequestOverride: toQueuedChatTurn(item.message).request,
        onDelivery: accepted => {
          if (accepted) state.followUps.remove(item.id);
          else {
            const uncertain = state.followUps.items.find(entry => entry.id === item.id)?.status === 'uncertain';
            if (!uncertain) {
              // The question widget retains a rejected answer for retry.
              if (item.message.answeringQuestionId) state.followUps.remove(item.id);
              else state.followUps.setStatus(item.id, 'queued');
            }
            state.followUps.pause();
          }
          item.message.onDelivery?.(accepted);
          this.updateQueueIndicator();
        },
      }).catch(() => this.reportDeferredReviewableSettlement());
    }, 0);
    return true;
  }

  resumeQueuedMessages(): void {
    this.deps.state.followUps.resume();
    this.processQueuedMessage();
    this.updateQueueIndicator();
  }

  private deferReviewableSettlement(report: (() => void) | null): void {
    this.deferredReviewableSettlement.defer(this.deps.state.currentConversationId, report);
  }

  private hasDeferredReviewableSettlement(): boolean {
    this.discardDeferredReviewForDifferentConversation();
    return this.deferredReviewableSettlement.hasFor(this.deps.state.currentConversationId);
  }

  private reportDeferredReviewableSettlement(): void {
    if (!this.hasDeferredReviewableSettlement()) return;
    this.deferredReviewableSettlement.takeFor(this.deps.state.currentConversationId)?.();
  }

  private reportCurrentOrDeferredReviewableSettlement(
    currentReporter: (() => void) | null,
  ): void {
    const reporter = currentReporter
      ?? this.deferredReviewableSettlement.takeFor(this.deps.state.currentConversationId);
    this.clearDeferredReviewableSettlement();
    reporter?.();
  }

  private discardDeferredReviewForDifferentConversation(): void {
    this.deferredReviewableSettlement.discardForDifferentConversation(
      this.deps.state.currentConversationId,
    );
  }

  private clearDeferredReviewableSettlement(): void {
    this.deferredReviewableSettlement.clear();
  }

  canSteerFollowUp(): boolean {
    return this.deps.state.isStreaming
      && this.pendingSteersByConversation.get(this.deps.state.currentConversationId) === null
      && this.getActiveCapabilities().supportsTurnSteer === true
      && this.getExecutionCoordinator() !== null;
  }

  private restoreDefinitelyUnsentSteer(pending: PendingSteerState): void {
    if (
      pending.retryState === 'restored'
      || pending.providerDisposition === 'accepted-awaiting-correlation'
    ) {
      return;
    }

    pending.providerDisposition = 'definitely-unsent';
    pending.correlationState = 'settled';
    this.pendingSteersByConversation.clearUi(pending);
    if (
      pending.conversationId !== this.deps.state.currentConversationId
      || this.deps.state.isSwitchingConversation
      || this.deps.state.isCreatingConversation
    ) {
      pending.retryState = 'parked';
      return;
    }

    this.restoreDefinitelyUnsentSteerForActiveConversation(pending);
  }

  private restoreDefinitelyUnsentSteerForActiveConversation(
    pending: PendingSteerState,
  ): void {
    if (pending.retryState === 'restored') return;

    pending.retryState = 'restored';
    this.pendingSteersByConversation.release(pending);

    const { state } = this.deps;
    state.followUps.setStatus(pending.queueItemId, 'queued');
    if (!state.isStreaming || state.cancelRequested) state.followUps.pause();
    this.updateQueueIndicator();
  }

  onConversationActivated(): void {
    this.discardDeferredReviewForDifferentConversation();
    if (
      this.deps.state.isSwitchingConversation
      || this.deps.state.isCreatingConversation
    ) {
      return;
    }
    const pending = this.pendingSteersByConversation.get(this.deps.state.currentConversationId);
    if (
      pending?.providerDisposition === 'definitely-unsent'
      && pending.retryState === 'parked'
    ) {
      this.restoreDefinitelyUnsentSteerForActiveConversation(pending);
      return;
    }
    this.updateQueueIndicator();
  }

  async steerQueuedMessage(itemId?: string): Promise<void> {
    const { state } = this.deps;
    const coordinator = this.getExecutionCoordinator();
    const conversationId = state.currentConversationId;
    const item = itemId
      ? state.followUps.items.find(entry => entry.id === itemId)
      : state.followUps.next;
    if (item?.status !== 'queued' || !this.canSteerFollowUp() || !coordinator) {
      return;
    }
    if (!conversationId) return;

    const queuedMessage = cloneQueuedMessage(item.message);
    state.followUps.setStatus(item.id, 'sending');
    const { displayContent, request } = toQueuedChatTurn(queuedMessage);
    const submission = this.turnSubmissionBuilder.buildExecutionSubmission(displayContent, request);
    const pending: PendingSteerState = {
      conversationId,
      coordinator,
      correlationState: 'pending',
      expectedProviderMessage: {
        displayContent,
        persistedContent: request.text,
        currentNote: /^\/compact(\s|$)/i.test(request.text)
          ? undefined
          : request.currentNotePath,
        images: request.images,
      },
      inputRecordId: submission.inputRecordId,
      queueItemId: item.id,
      message: queuedMessage,
      providerDisposition: 'awaiting-result',
      retryState: 'blocked',
      uiState: 'visible',
    };
    this.pendingSteersByConversation.register(pending);
    this.updateQueueIndicator();

    try {
      const accepted = await coordinator.steer(submission);
      if (!accepted) {
        if (pending.providerDisposition === 'accepted-awaiting-correlation') return;
        this.restoreDefinitelyUnsentSteer(pending);
        new Notice(t('chat.followUp.failed'));
        return;
      }

      queuedMessage.onDelivery?.(true);
      pending.providerDisposition = 'accepted-awaiting-correlation';
      if (pending.correlationState === 'pending') state.followUps.setStatus(item.id, 'accepted');
      this.pendingSteersByConversation.clearUi(pending);
      if (pending.correlationState !== 'pending') {
        this.pendingSteersByConversation.release(pending);
      }
      if (pending.conversationId === state.currentConversationId) {
        this.deps.getFileContextManager()?.markCurrentNoteSent();
      }
    } catch (error) {
      if (pending.providerDisposition === 'accepted-awaiting-correlation') return;
      if (error instanceof ChatExecutionPreHandoffError) {
        this.restoreDefinitelyUnsentSteer(pending);
        new Notice(t('chat.followUp.failed'));
        return;
      }

      pending.providerDisposition = 'ambiguous-awaiting-reconciliation';
      state.followUps.setStatus(item.id, 'uncertain');
      state.followUps.pause();
      this.pendingSteersByConversation.clearUi(pending);
      if (pending.correlationState !== 'pending') {
        this.pendingSteersByConversation.release(pending);
      }
      new Notice(
        t('chat.followUp.unconfirmed'),
      );
    }
  }

  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl?.querySelector<HTMLElement>('.claudian-message-content') ?? null;

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.response.reset();
    state.currentThinkingState = null;
  }

  private resetProviderMessageBoundaryState(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  private async handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    switch (chunk.type) {
      case 'user_message_start':
        await this.handleProviderUserMessageStart(chunk);
        return true;
      case 'assistant_message_start':
        await this.handleProviderAssistantMessageStart();
        return true;
      default:
        return false;
    }
  }

  private async handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    if (!this.sawInitialProviderUserMessage) {
      this.pendingProviderUserMessages.shift();
      this.sawInitialProviderUserMessage = true;
      return;
    }

    const pendingSteer = this.pendingSteersByConversation.get(this.deps.state.currentConversationId);
    const expected = pendingSteer?.correlationState === 'pending'
      ? pendingSteer.expectedProviderMessage
      : this.pendingProviderUserMessages.shift();
    let acceptanceError: unknown;
    if (pendingSteer?.correlationState === 'pending') {
      pendingSteer.providerDisposition = 'accepted-awaiting-correlation';
      pendingSteer.correlationState = 'settled';
      this.pendingSteersByConversation.clearUi(pendingSteer);
      try {
        await pendingSteer.coordinator.acceptSteerFromProviderEvent(
          pendingSteer.inputRecordId,
          chunk.itemId,
        );
      } catch (error) {
        acceptanceError = error;
      }
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = this.shouldDiscardPendingAssistantPlaceholder(previousAssistant);
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
        const responseStartTime = this.deps.state.responseStartTime;
        if (responseStartTime !== null) {
          const durationSeconds = Math.floor(
            (performance.now() - responseStartTime) / 1_000,
          );
          if (durationSeconds > 0) {
            previousAssistant.durationSeconds = durationSeconds;
            previousAssistant.durationFlavorWord = COMPLETION_FLAVOR_WORDS[
              Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)
            ];
          }
        }
        this.finalizeTranscriptTurn(previousAssistant);
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: expected?.currentNote,
        images,
        ...(chunk.itemId ? { userMessageId: chunk.itemId } : {}),
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }
    if (pendingSteer?.correlationState === 'settled') {
      this.deps.state.followUps.remove(pendingSteer.queueItemId);
      this.pendingSteersByConversation.release(pendingSteer);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
    if (acceptanceError) throw toError(acceptanceError);
  }

  private async handleProviderAssistantMessageStart(): Promise<void> {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (previousAssistant) {
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      this.deps.renderer.finalizeCompletedWork(previousAssistant, false, false);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private shouldDiscardPendingAssistantPlaceholder(message: ChatMessage | null): boolean {
    return this.awaitingProviderAssistantStart
      && !!message
      && !message.content.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.contentBlocks?.length ?? 0) === 0;
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.response.reset();
    state.currentThinkingState = null;
  }

  private rollbackFailedTurn(
    messagesBeforeTurn: ChatMessage[],
    hadPendingConversationSave: boolean,
  ): void {
    const { state, renderer } = this.deps;
    const retainedMessageIds = new Set(messagesBeforeTurn.map(message => message.id));
    for (const message of state.messages) {
      if (!retainedMessageIds.has(message.id)) {
        renderer.removeMessage(message.id);
      }
    }

    state.messages = messagesBeforeTurn;
    state.hasPendingConversationSave = hadPendingConversationSave;
    this.resetTurnStreamingState();

    if (messagesBeforeTurn.length === 0) {
      this.deps.getWelcomeEl()?.removeClass('claudian-hidden');
    }
  }

  private finishAcceptedMissingSession(streamGeneration: number): void {
    if (this.deps.state.streamGeneration !== streamGeneration) return;
    this.resetTurnStreamingState();
  }

  private resetTurnStreamingState(): void {
    const { state, streamController } = this.deps;
    const message = state.messages.find(candidate => candidate.id === state.response.messageId);
    streamController.hideThinkingIndicator();
    state.isStreaming = false;
    state.cancelRequested = false;
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.response.reset();
    state.currentThinkingState = null;
    state.responseStartTime = null;
    this.deps.getSubagentManager().resetStreamingState(new Set(message?.toolCalls?.map(tool => tool.id)));
  }

  // ============================================
  // Title Generation
  // ============================================

  /**
   * Triggers AI title generation after first user message.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, conversationController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    if (!state.currentConversationId) {
      const selectedModel = this.getAuxiliaryModel() ?? undefined;
      const currentNote = this.deps.getFileContextManager()?.getCurrentNotePath()
        ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: this.getActiveProviderId(),
        ...(selectedModel ? { selectedModel } : {}),
        ...(currentNote ? { currentNote } : {}),
      });
      state.currentConversationId = conversation.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;

    // Set immediate fallback title
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const convId = state.currentConversationId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    titleService.generateTitle(
      convId,
      userContent,
      async (conversationId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(conversationId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(conversationId, result.title);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch(async () => {
      // A rejected service may fail before it can call back with a failed result
      // (for example, during provider workspace initialization). Clear the
      // pending state so recent-conversation indicators cannot spin forever.
      try {
        const currentConv = await plugin.getConversationById(convId);
        if (!currentConv) return;

        await plugin.updateConversation(convId, {
          titleGenerationStatus: currentConv.title === expectedTitle ? 'failed' : undefined,
        });
        conversationController.updateHistoryDropdown();
      } catch {
        // Title generation remains best-effort if status persistence also fails.
      }
    });
  }

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;
    this.stopGeneration++;
    const activeTurn = this.turnCoordinator.current;
    if (state.isStreaming && activeTurn) {
      this.stoppedTurn = activeTurn;
      void activeTurn.then(
        () => { if (this.stoppedTurn === activeTurn) this.stoppedTurn = null; },
        () => { if (this.stoppedTurn === activeTurn) this.stoppedTurn = null; },
      );
    }
    state.followUps.pause();
    this.updateQueueIndicator();
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    this.pendingSteersByConversation.clearCurrentUi(this.deps.state.currentConversationId);
    this.getExecutionCoordinator()?.cancel();
    streamController.hideThinkingIndicator();
    streamController.clearToolActivities();
  }

  /** Cancels the active turn and waits for its cleanup and conversation persistence. */
  async cancelStreamingAndWait(): Promise<void> {
    const activeTurn = this.turnCoordinator.current;
    this.cancelStreaming();
    await activeTurn;
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    syncComposerAutoScroll(
      () => this.deps.plugin.settings.enableAutoScroll ?? true,
      () => this.deps.state.autoScrollEnabled,
      this.deps.getMessagesEl,
    );
  }

  // ============================================
  // Instruction Mode
  // ============================================

  async handleInstructionSubmit(rawInstruction: string): Promise<void> {
    await this.instructionSubmissionController.submit(rawInstruction);
  }

  // ============================================
  // Approval Dialogs
  // ============================================

  async handleApprovalRequest(
    toolName: string,
    approvalInput: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl?.parentElement;
    if (!inputContainerEl || !parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    // Build header element, then detach — InlineAskUserQuestion will re-attach it
    const headerEl = parentEl.createDiv({ cls: 'claudian-ask-approval-info' });
    headerEl.remove();

    const toolEl = headerEl.createDiv({ cls: 'claudian-ask-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'claudian-ask-approval-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, toolName);
    toolEl.createSpan({ text: toolName, cls: 'claudian-ask-approval-tool-name' });

    if (approvalOptions?.decisionReason) {
      headerEl.createDiv({ text: approvalOptions.decisionReason, cls: 'claudian-ask-approval-reason' });
    }
    if (approvalOptions?.blockedPath) {
      headerEl.createDiv({ text: approvalOptions.blockedPath, cls: 'claudian-ask-approval-blocked-path' });
    }
    if (approvalOptions?.agentID) {
      headerEl.createDiv({ text: t('chat.approval.agent', { agent: approvalOptions.agentID }), cls: 'claudian-ask-approval-agent' });
    }

    const command = typeof approvalInput.command === 'string'
      ? approvalInput.command
      : description;
    if (hasSuspiciousCommandText(command)) {
      headerEl.createDiv({
        text: t('chat.approval.suspicious'),
        cls: 'claudian-ask-approval-warning',
      });
    }

    const descriptionEl = headerEl.createDiv({
      text: description,
      cls: 'claudian-ask-approval-desc',
    });
    descriptionEl.setAttribute('aria-label', t('chat.approval.details', { tool: toolName }));
    descriptionEl.setAttribute('role', 'region');
    descriptionEl.setAttribute('tabindex', '0');
    descriptionEl.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
        event.stopPropagation();
      }
    });

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const questionOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) {
        optionDecisionMap.set(value, option.decision);
      }
      return {
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });
    const input = {
      questions: [{
        question: t('chat.approval.question'),
        options: questionOptions,
        isOther: false,
        isSecret: false,
      }],
    };

    const result = await this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingApprovalInline = inline; },
      signal,
      { title: t('chat.approval.title'), headerEl, showCustomInput: false, immediateSelect: true },
    );

    if (!result) return 'cancel';
    const selected = Object.values(result)[0];
    const selectedValue = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedValue !== 'string') {
      new Notice(t('chat.approval.unexpected', { value: String(selectedValue) }));
      return 'cancel';
    }

    const decision = optionDecisionMap.get(selectedValue);
    if (decision) {
      return decision;
    }

    return {
      type: 'select-option',
      value: selectedValue,
    };
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl?.parentElement;
    if (!inputContainerEl || !parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingAskInline = inline; },
      signal,
    );
  }

  updateAsyncQuestion(tool: ToolCallInfo): void {
    this.asyncQuestions.update(tool);
  }

  private showAsyncQuestion(
    tool: ToolCallInfo,
    signal: AbortSignal,
    onSubmit: (answers: AskUserAnswers) => Promise<void>,
  ): Promise<AskUserAnswers | null> {
    return this.deps.state.interactions.requestAsyncQuestion({
      kind: 'async-question', interactionId: `present-async-question:${tool.id}`,
      input: tool.input, onSubmit,
    }, signal).then(response => response.answers);
  }

  private renderAsyncQuestion(
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    onSubmit: (answers: AskUserAnswers) => Promise<void>,
  ): Promise<AskUserAnswers | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl?.parentElement;
    if (!inputContainerEl || !parentEl) throw new Error('Input container is detached from DOM');
    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      { ...input },
      inline => { this.pendingAskInline = inline; },
      signal,
      { title: 'Answer agent question', onSubmit },
    );
  }

  private async answerAsyncQuestion(
    tool: ToolCallInfo,
    answers: AskUserAnswers,
    conversationId: string | null,
  ): Promise<void> {
    const { state } = this.deps;
    const belongsToConversation = state.currentConversationId === conversationId
      && state.messages.some(message => message.toolCalls?.some(candidate => candidate.id === tool.id));
    if (!belongsToConversation) throw new Error('This question belongs to a different conversation.');

    const reply = ProviderRegistry.formatQuestionReply(this.getActiveProviderId(), tool, answers);
    if (!reply) throw new Error('The provider could not format this question reply.');
    const submission = this.turnSubmissionBuilder.buildRequest({
      content: reply.content,
      images: [],
      editorContextOverride: null,
      browserContextOverride: null,
      canvasContextOverride: null,
    });
    await new Promise<void>((resolve, reject) => {
      void this.sendMessage({
        answeringQuestionId: tool.id,
        content: reply.content,
        displayContentOverride: reply.displayContent,
        deliveryMode: 'steer',
        images: [],
        onDelivery: accepted => accepted
          ? resolve()
          : reject(new Error('The answer was not sent. Please try again.')),
        turnRequestOverride: submission.turnRequest,
      }).catch(reject);
    });
  }

  private showInlineQuestion(
    parentEl: HTMLElement,
    inputContainerEl: HTMLElement,
    input: Record<string, unknown>,
    setPending: (inline: InlineAskUserQuestion | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ): Promise<Record<string, string | string[]> | null> {
    this.deps.streamController.hideThinkingIndicator();
    this.inputContainerVisibility.hide(inputContainerEl);

    return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (result: Record<string, string | string[]> | null) => {
          setPending(null);
          this.inputContainerVisibility.restore(inputContainerEl);
          resolve(result);
        },
        signal,
        config,
      );
      setPending(inline);
      try {
        inline.render();
      } catch (err) {
        setPending(null);
        this.inputContainerVisibility.restore(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
    presentation?: ExitPlanModePresentationOptions,
  ): Promise<ExitPlanModeDecision | null> {
    const { state, streamController } = this.deps;
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl?.parentElement;
    if (!inputContainerEl || !parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    streamController.hideThinkingIndicator();
    this.inputContainerVisibility.hide(inputContainerEl);

    const enrichedInput = state.planFilePath
      ? { ...input, planFilePath: state.planFilePath }
      : input;

    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderer.renderContent(el, markdown);

    const planPathPrefix = this.getActiveCapabilities().planPathPrefix;

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision: ExitPlanModeDecision | null) => {
          this.pendingExitPlanModeInline = null;
          this.inputContainerVisibility.restore(inputContainerEl);
          resolve(decision);
        },
        signal,
        renderContent,
        planPathPrefix,
        presentation,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingExitPlanModeInline = null;
        this.inputContainerVisibility.restore(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  dismissPendingApprovalPrompt(): void {
    if (this.pendingApprovalInline) {
      this.pendingApprovalInline.destroy();
      this.pendingApprovalInline = null;
    }
  }

  dismissPendingApproval(): void {
    this.deps.state.dismissInteractions('cancelled');
    this.dismissPendingApprovalPrompt();
    if (this.pendingAskInline) {
      this.pendingAskInline.destroy();
      this.pendingAskInline = null;
    }
    if (this.pendingExitPlanModeInline) {
      this.pendingExitPlanModeInline.destroy();
      this.pendingExitPlanModeInline = null;
    }
    this.dismissPendingPlanApproval();
    this.inputContainerVisibility.reset(this.deps.getInputContainerEl());
  }

  private async showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    return this.deps.state.interactions.requestLocalPlanApproval({
      kind: 'local-plan', interactionId: `local-plan:${this.deps.generateId()}`,
    }, new AbortController().signal);
  }

  private renderPlanApproval(signal: AbortSignal): Promise<PlanApprovalDecision | null> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl?.parentElement;
    if (!inputContainerEl || !parentEl) throw new Error('Input container is detached from DOM');
    this.inputContainerVisibility.hide(inputContainerEl);
    return new Promise<PlanApprovalDecision | null>((resolve, reject) => {
      let failed = false;
      const abort = () => inline.destroy();
      const inline = new InlinePlanApproval(parentEl, decision => {
        signal.removeEventListener('abort', abort);
        this.pendingPlanApproval = null;
        this.inputContainerVisibility.restore(inputContainerEl);
        if (!failed) resolve(decision);
      });
      this.pendingPlanApproval = inline;
      signal.addEventListener('abort', abort, { once: true });
      try { inline.render(); } catch (err) {
        failed = true;
        signal.removeEventListener('abort', abort);
        inline.destroy();
        this.pendingPlanApproval = null;
        this.inputContainerVisibility.restore(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  private dismissPendingPlanApproval(): void {
    this.pendingPlanApproval?.destroy();
    this.pendingPlanApproval = null;
  }

  // ============================================
  // Resume Session Dropdown
  // ============================================

  handleResumeKeydown(e: KeyboardEvent): boolean {
    return this.resumeDropdownController.handleKeydown(e);
  }

  isResumeDropdownVisible(): boolean {
    return this.resumeDropdownController.isVisible();
  }

  destroyResumeDropdown(): void {
    this.resumeDropdownController.destroy();
  }
}
