import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { FeatureHost } from '../../FeatureHost';
import { InputController } from '../controllers/InputController';
import { getTabProviderId } from './providerResolution';
import type { TabData } from './types';

export interface TabInputControllerOptions {
  ensureExecutionInitialized: () => Promise<boolean>;
  generateId: () => string;
  getProviderSettings: () => Record<string, unknown>;
  getAuxiliaryModel: () => string | null;
  openConversation?: (conversationId: string) => Promise<void>;
  handleNewConversationCommand?: () => Promise<boolean>;
  handleNewSessionPlan?: (planContent: string) => Promise<boolean>;
  onForkAll?: () => Promise<void>;
  toggleFastMode: () => Promise<boolean>;
  restorePrePlanPermissionModeIfNeeded: () => void | Promise<void>;
  onDiagnosticError: (error: unknown) => void;
  onFollowUpStateChanged?: () => void;
}

/**
 * Assembles InputController from the tab runtime and a small set of layout
 * and provider-transition hooks. Input behavior itself remains owned by the
 * controller; this module only owns dependency wiring and preflight policy.
 */
export function createTabInputController(
  tab: TabData,
  plugin: FeatureHost,
  options: TabInputControllerOptions,
): InputController {
  const { state, services, controllers } = tab;
  return new InputController({
    plugin,
    state,
    renderer: tab.session.messagePresentation,
    streamController: controllers.streamController!,
    selectionController: { getContext: () => controllers.selectionController?.getContext() ?? null },
    browserSelectionController: { getContext: () => controllers.browserSelectionController?.getContext() ?? null },
    canvasSelectionController: { getContext: () => controllers.canvasSelectionController?.getContext() ?? null },
    conversationController: controllers.conversationController!,
    composer: tab.session.composer,
    getInputEl: () => tab.session.presentation?.dom.inputEl ?? null,
    getQuotedMessageTexts: () => tab.ui.quotedMessages.map(quote => quote.text),
    clearQuotedMessages: () => {
      tab.ui.quotedMessages = [];
      tab.ui.contextTray?.clearItems('message-quotes');
      const input = tab.session.presentation?.dom.inputEl;
      if (input) {
        const EventConstructor = input.ownerDocument.defaultView?.Event ?? Event;
        input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
      }
    },
    getInputContainerEl: () => tab.session.presentation?.dom.inputContainerEl ?? null,
    getWelcomeEl: () => tab.session.presentation?.dom.welcomeEl ?? null,
    getMessagesEl: () => tab.session.messagePresentation.messagesElement,
    getFileContextManager: () => tab.ui.fileContextManager,
    getImageContextManager: () => tab.ui.imageContextManager,
    getMcpServerSelector: () => tab.ui.mcpServerSelector,
    getExternalContextSelector: () => tab.ui.externalContextSelector,
    getInstructionModeManager: () => tab.ui.instructionModeManager,
    getInstructionRefineService: () => services.instructionRefineService,
    getTitleGenerationService: () => services.titleGenerationService,
    getStatusPanel: () => tab.ui.statusPanel,
    generateId: options.generateId,
    getProviderSettings: options.getProviderSettings,
    getAuxiliaryModel: options.getAuxiliaryModel,
    getExecutionCoordinator: () => tab.executionCoordinator,
    getSubagentManager: () => services.subagentManager,
    getTabProviderId: () => getTabProviderId(tab, plugin),
    turnOwner: tab.session,
    ensureExecutionInitialized: options.ensureExecutionInitialized,
    openConversation: options.openConversation,
    handleNewConversationCommand: options.handleNewConversationCommand,
    handleNewSessionPlan: options.handleNewSessionPlan,
    onForkAll: options.onForkAll,
    toggleFastMode: options.toggleFastMode,
    restorePrePlanPermissionModeIfNeeded: options.restorePrePlanPermissionModeIfNeeded,
    captureReviewableSettlement: outcome => tab.session.captureReviewableSettlement(outcome),
    onDiagnosticError: options.onDiagnosticError,
    onFollowUpStateChanged: options.onFollowUpStateChanged,
    preflightExecution: async () => {
      const installation = await plugin.providerHost.cliLifecycle?.check(tab.providerId);
      if (installation?.operation?.status === 'running') return new Error('Wait for this provider’s CLI operation to finish.');
      if (installation?.status === 'missing' || installation?.status === 'broken') {
        return new Error(installation.error ?? 'Provider CLI not found.');
      }
      let diagnostics;
      try {
        diagnostics = await ProviderRegistry.collectDiagnostics(tab.providerId, {
          settings: plugin.settings,
          resolveCliPath: () => plugin.providerHost.getResolvedProviderCliPath(tab.providerId),
        });
      } catch {
        return new Error('Provider CLI not found.');
      }
      if (diagnostics?.readiness?.status === 'disabled') {
        return new Error('Provider is not enabled.');
      }
      const blockedCheck = diagnostics?.readiness?.checks.find(check => check.status === 'blocked');
      if (!blockedCheck) return null;
      if (blockedCheck.id === 'cli') return new Error('Provider CLI not found.');
      if (blockedCheck.id === 'selection') return new Error('No chat model is selected.');
      if (blockedCheck.id === 'enabled') return new Error('Provider is not enabled.');
      return new Error('Provider model catalog is unavailable.');
    },
  });
}
