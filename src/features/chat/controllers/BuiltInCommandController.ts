import { Notice } from 'obsidian';

import {
  type BuiltInCommand,
  isBuiltInCommandSupported,
} from '../../../core/commands/builtInCommands';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { AddExternalContextResult } from '../ui/InputToolbar';

export interface BuiltInCommandControllerDeps {
  getCapabilities: () => ProviderCapabilities;
  createNewConversation: () => Promise<void>;
  handleNewConversationCommand?: () => Promise<boolean>;
  getExternalContextSelector: () => {
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  showResumeDropdown: () => void;
  onForkAll?: () => Promise<void>;
  toggleFastMode?: () => Promise<boolean>;
}

/** Routes provider-neutral slash commands to the feature-owned capabilities. */
export class BuiltInCommandController {
  constructor(private readonly deps: BuiltInCommandControllerDeps) {}

  async execute(command: BuiltInCommand, args: string): Promise<void> {
    const capabilities = this.deps.getCapabilities();
    if (!isBuiltInCommandSupported(command, capabilities)) {
      new Notice(`/${command.name} is not supported by this provider.`);
      return;
    }

    switch (command.action) {
      case 'clear': {
        const handled = await this.deps.handleNewConversationCommand?.() ?? false;
        if (!handled) await this.deps.createNewConversation();
        return;
      }
      case 'add-dir': {
        const selector = this.deps.getExternalContextSelector();
        if (!selector) {
          new Notice('External context selector not available.');
          return;
        }
        const result = selector.addExternalContext(args);
        new Notice(result.success ? `Added external context: ${result.normalizedPath}` : result.error);
        return;
      }
      case 'resume':
        this.deps.showResumeDropdown();
        return;
      case 'fork':
        if (!capabilities.supportsFork) {
          new Notice('Fork is not supported by this provider.');
        } else if (!this.deps.onForkAll) {
          new Notice('Fork not available.');
        } else {
          await this.deps.onForkAll();
        }
        return;
      case 'fast':
        try {
          const toggled = await this.deps.toggleFastMode?.() ?? false;
          if (!toggled) {
            new Notice('Fast mode is not available for this model.');
          }
        } catch {
          new Notice('Failed to toggle fast mode.');
        }
        return;
      default: {
        const action = typeof (command as { action?: unknown }).action === 'string'
          ? (command as { action: string }).action
          : 'unknown';
        new Notice(`Unknown command: ${action}`);
      }
    }
  }
}
