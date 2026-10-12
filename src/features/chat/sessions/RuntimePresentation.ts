import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { TabControllers, TabDOMElements, TabManagerViewHost, TabUIComponents } from '../tabs/types';

export type PresentationControllers = Pick<TabControllers,
  'selectionController' | 'browserSelectionController' | 'canvasSelectionController' | 'navigationController'
>;

export interface RuntimePresentation {
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
    contextUsageMeter: null, statusPanel: null, navigationSidebar: null, promptSuggestion: null,
  };
}
