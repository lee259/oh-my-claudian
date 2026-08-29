import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
import { type ChatMessage,isCanonicalUserMessage } from '../../../core/types';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import type { EditorSelectionContext } from '../../../utils/editor';
import type { FeatureHost } from '../../FeatureHost';
import type { ChatTurnSubmission } from '../execution/ChatExecutionCoordinator';
import type { ChatState } from '../state/ChatState';
import type { ChatTurnRequest } from '../state/types';
import type { FileContextManager } from '../ui/FileContext';
import type { McpServerSelector } from '../ui/InputToolbar';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import type { SelectionController } from './SelectionController';

export interface TurnSubmissionBuilderDeps {
  plugin: FeatureHost;
  state: ChatState;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  getFileContextManager: () => FileContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => { getExternalContexts: () => string[] } | null;
  getProviderId: () => ProviderId;
  getProviderCapabilities: () => ProviderCapabilities;
  getAuxiliaryModel: () => string | null;
  generateId: () => string;
}

export interface BuildTurnRequestOptions {
  content: string;
  images?: ChatMessage['images'];
  editorContextOverride?: EditorSelectionContext | null;
  browserContextOverride?: BrowserSelectionContext | null;
  canvasContextOverride?: CanvasSelectionContext | null;
}

/** Builds provider-neutral turn requests from the current composer state. */
export class TurnSubmissionBuilder {
  constructor(private readonly deps: TurnSubmissionBuilderDeps) {}

  buildRequest(options: BuildTurnRequestOptions): {
    displayContent: string;
    turnRequest: ChatTurnRequest;
  } {
    const fileContextManager = this.deps.getFileContextManager();
    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;
    const externalContextPaths = this.deps.getExternalContextSelector()?.getExternalContexts();
    const isCompact = /^\/compact(\s|$)/i.test(options.content);
    const transformedText = !isCompact && fileContextManager
      ? fileContextManager.transformContextMentions(options.content)
      : options.content;
    const enabledMcpServers = this.deps.getMcpServerSelector()?.getEnabledServers();
    const contextFiles = fileContextManager?.getAttachedFiles?.();

    return {
      displayContent: options.content,
      turnRequest: {
        text: transformedText,
        images: options.images,
        currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
        editorSelection: options.editorContextOverride !== undefined
          ? options.editorContextOverride
          : this.deps.selectionController.getContext(),
        browserSelection: options.browserContextOverride !== undefined
          ? options.browserContextOverride
          : (this.deps.browserSelectionController?.getContext() ?? null),
        canvasSelection: options.canvasContextOverride !== undefined
          ? options.canvasContextOverride
          : this.deps.canvasSelectionController.getContext(),
        externalContextPaths: externalContextPaths?.length ? externalContextPaths : undefined,
        contextFiles: contextFiles?.size ? [...contextFiles] : undefined,
        enabledMcpServers: enabledMcpServers?.size ? enabledMcpServers : undefined,
      },
    };
  }

  buildExecutionSubmission(
    displayContent: string,
    request: ChatTurnRequest,
    user?: ChatMessage,
    assistant?: ChatMessage,
  ): ChatTurnSubmission {
    const providerId = this.deps.getProviderId();
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.plugin.settings,
      providerId,
    );
    const permissionMode = typeof settings.permissionMode === 'string'
      ? settings.permissionMode
      : undefined;
    const reasoning = typeof settings.effortLevel === 'string'
      ? settings.effortLevel
      : typeof settings.thinkingBudget === 'string' ? settings.thinkingBudget : undefined;
    const serviceTier = typeof settings.serviceTier === 'string' ? settings.serviceTier : undefined;
    const mode = permissionMode === 'plan' && this.deps.getProviderCapabilities().supportsPlanMode
      ? permissionMode
      : undefined;
    const systemPrompt = typeof this.deps.plugin.settings.systemPrompt === 'string'
      ? this.deps.plugin.settings.systemPrompt.trim()
      : '';
    const existingUserTurns = this.deps.state.messages.filter(isCanonicalUserMessage).length;

    return {
      canonicalText: request.text,
      configuration: {
        ...(request.enabledMcpServers ? { enabledMcpServers: [...request.enabledMcpServers] } : {}),
        ...(request.externalContextPaths ? { externalWorkspaceRoots: [...request.externalContextPaths] } : {}),
        ...(this.deps.getAuxiliaryModel() ? { model: this.deps.getAuxiliaryModel() ?? undefined } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(mode ? { mode } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        systemInstructions: systemPrompt
          ? { kind: 'explicit', instructions: systemPrompt }
          : { kind: 'none' },
      },
      context: {
        ...(request.browserSelection ? { browserSelection: request.browserSelection } : {}),
        ...(request.canvasSelection ? { canvasSelection: request.canvasSelection } : {}),
        ...(request.currentNotePath ? { currentNote: { path: request.currentNotePath } } : {}),
        ...(request.editorSelection ? { editorSelection: request.editorSelection } : {}),
        ...(request.externalContextPaths ? { externalContextPaths: [...request.externalContextPaths] } : {}),
        ...(request.contextFiles ? { contextFiles: [...request.contextFiles] } : {}),
      },
      conversationHistory: user && assistant
        ? this.deps.state.messages.slice(0, -2)
        : [...this.deps.state.messages],
      images: [...(request.images ?? [])],
      inputRecordId: this.deps.generateId(),
      ...(user ? { localMessageId: user.id } : {}),
      ...(user && assistant ? { messages: { assistant, user } } : {}),
      rawDisplayText: displayContent,
      timestamp: user?.timestamp ?? Date.now(),
      toolPolicy: { kind: 'provider-default' },
      userTurnOrdinal: user ? existingUserTurns : existingUserTurns + 1,
    };
  }
}
