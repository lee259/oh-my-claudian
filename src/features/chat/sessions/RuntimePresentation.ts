import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { ForkContext } from '../tabs/Tab';
import type { ProviderCatalogResolver, TabControllers, TabDOMElements, TabManagerViewHost, TabUIComponents } from '../tabs/types';

export type PresentationControllers = Pick<TabControllers,
  'selectionController' | 'browserSelectionController' | 'canvasSelectionController' | 'navigationController'
>;

export interface RuntimePresentationHooks {
  openConversation?: (conversationId: string) => Promise<void>;
  forkRequest?: (context: ForkContext) => Promise<void>;
  getProviderCatalog?: ProviderCatalogResolver;
}

export interface RuntimePresentation {
  readonly epoch: symbol;
  isActive?: () => boolean;
  getActivationRevision?: () => number;
  captureReviewableSettlement?: (outcome?: 'completed' | 'error') => () => void;
  hooks?: RuntimePresentationHooks;
  dom: TabDOMElements;
  ui: TabUIComponents;
  controllers: PresentationControllers;
  renderer: MessageRenderer | null;
  viewHost: Partial<TabManagerViewHost> | null;
}

export function createEmptyPresentationUI(): TabUIComponents {
  return {
    contextTray: null, quotedMessages: [], scopePreview: null,
    fileContextManager: null, imageContextManager: null,
    modelSelector: null, modeSelector: null, thinkingBudgetSelector: null,
    externalContextSelector: null, mcpServerSelector: null, permissionToggle: null,
    serviceTierToggle: null, refreshComposerLocale: null, slashCommandDropdown: null,
    instructionModeManager: null, bangBashModeManager: null,
    contextUsageMeter: null, statusPanel: null, navigationSidebar: null, promptSuggestion: null, scenePrompts: null,
  };
}
