import { Notice } from 'obsidian';

import { t } from '@/i18n/i18n';

import { stringifyDiagnosticError } from '../../../core/providers/ProviderDiagnostics';
import type { InstructionRefineService } from '../../../core/providers/types';
import { InstructionModal } from '../../../shared/modals/InstructionConfirmModal';
import { appendMarkdownSnippet } from '../../../utils/markdown';
import type { FeatureHost } from '../../FeatureHost';
import type { InstructionModeManager } from '../ui/InstructionModeManager';

export interface InstructionSubmissionControllerDeps {
  plugin: FeatureHost;
  getInstructionRefineService: () => InstructionRefineService | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getModelOverride: () => string | null;
  ensureExecutionInitialized?: () => Promise<boolean>;
}

/** Coordinates the auxiliary instruction-refinement modal and settings update. */
export class InstructionSubmissionController {
  constructor(private readonly deps: InstructionSubmissionControllerDeps) {}

  async submit(rawInstruction: string): Promise<void> {
    const { plugin } = this.deps;
    if (this.deps.ensureExecutionInitialized) {
      const ready = await this.deps.ensureExecutionInitialized();
      if (!ready) {
        new Notice(t('chat.instructions.initializeFailed'));
        return;
      }
    }

    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();
    if (!instructionRefineService) return;

    const existingPrompt = plugin.settings.systemPrompt;
    let modal: InstructionModal | null = null;
    let wasCancelled = false;
    try {
      modal = new InstructionModal(plugin.app, rawInstruction, {
        onAccept: (finalInstruction) => {
          instructionRefineService.cancel();
          void (async (): Promise<void> => {
            await plugin.mutateSettings((settings) => {
              settings.systemPrompt = appendMarkdownSnippet(
                settings.systemPrompt,
                finalInstruction,
              );
            });
            new Notice(t('chat.instructions.added'));
            instructionModeManager?.clear();
          })();
        },
        onReject: () => {
          wasCancelled = true;
          instructionRefineService.cancel();
          instructionModeManager?.clear();
        },
        onClarificationSubmit: async (response) => {
          this.syncModelOverride(instructionRefineService);
          const result = await instructionRefineService.continueConversation(response);
          if (wasCancelled) return;
          this.presentResult(
            result,
            modal,
            instructionModeManager,
            instructionRefineService,
            'Failed to process response',
          );
        },
      });
      modal.open();

      this.syncModelOverride(instructionRefineService);
      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(rawInstruction, existingPrompt);
      if (wasCancelled) return;
      this.presentResult(
        result,
        modal,
        instructionModeManager,
        instructionRefineService,
        'Failed to refine instruction',
      );
    } catch (error) {
      instructionRefineService.cancel();
      const errorMessage = stringifyDiagnosticError(error);
      new Notice(t('common.errorDetails', { message: t('common.error'), error: errorMessage }));
      modal?.showError(errorMessage);
      instructionModeManager?.clear();
    }
  }

  private syncModelOverride(instructionRefineService: InstructionRefineService): void {
    instructionRefineService.setModelOverride?.(this.deps.getModelOverride() ?? undefined);
  }

  private presentResult(
    result: Awaited<ReturnType<InstructionRefineService['refineInstruction']>>,
    modal: InstructionModal | null,
    instructionModeManager: InstructionModeManager | null,
    instructionRefineService: InstructionRefineService,
    fallbackError: string,
  ): void {
    if (!result.success) {
      if (result.error === 'Cancelled') return;
      instructionRefineService.cancel();
      const errorMessage = result.error || fallbackError;
      new Notice(errorMessage);
      modal?.showError(errorMessage);
      instructionModeManager?.clear();
      return;
    }
    if (result.clarification) {
      modal?.showClarification(result.clarification);
    } else if (result.refinedInstruction) {
      modal?.showConfirmation(result.refinedInstruction);
    } else {
      instructionRefineService.cancel();
      new Notice(t('chat.instructions.empty'));
      modal?.showError(t('chat.instructions.empty'));
      instructionModeManager?.clear();
    }
  }
}
