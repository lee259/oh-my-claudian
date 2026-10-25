import { Notice } from 'obsidian';

import { t } from '@/i18n/i18n';
import type { ComposerInputElement } from '@/shared/components/ComposerInput';

import { ResumeSessionDropdown } from '../../../shared/components/ResumeSessionDropdown';
import type { FeatureHost } from '../../FeatureHost';
import type { ConversationController } from './ConversationController';

export interface ResumeDropdownControllerDeps {
  plugin: FeatureHost;
  conversationController: ConversationController;
  getInputContainerEl: () => HTMLElement | null;
  getInputEl: () => ComposerInputElement | null;
  getCurrentConversationId: () => string | null;
  openConversation?: (conversationId: string) => Promise<void>;
}

/** Owns the ephemeral resume-session dropdown and its selection cleanup. */
export class ResumeDropdownController {
  private activeDropdown: ResumeSessionDropdown | null = null;

  constructor(private readonly deps: ResumeDropdownControllerDeps) {}

  handleKeydown(event: KeyboardEvent): boolean {
    return this.activeDropdown?.isVisible() === true
      ? this.activeDropdown.handleKeydown(event)
      : false;
  }

  isVisible(): boolean {
    return this.activeDropdown?.isVisible() ?? false;
  }

  destroy(): void {
    this.activeDropdown?.destroy();
    this.activeDropdown = null;
  }

  show(): void {
    this.destroy();
    const container = this.deps.getInputContainerEl();
    const input = this.deps.getInputEl();
    if (!container || !input) return;
    const conversations = this.deps.plugin.getConversationList();
    if (conversations.length === 0) {
      new Notice(t('chat.errors.noResume'));
      return;
    }
    const openConversation = this.deps.openConversation
      ?? ((id: string) => this.deps.conversationController.switchTo(id));
    this.activeDropdown = new ResumeSessionDropdown(
      container,
      input,
      conversations,
      this.deps.getCurrentConversationId(),
      {
        onDismiss: () => this.destroy(),
        onSelect: (id) => {
          this.destroy();
          openConversation(id).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(t('common.errorDetails', { message: t('chat.errors.openConversation'), error: message }));
          });
        },
      },
    );
  }
}
