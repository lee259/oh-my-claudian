import { Modal, Notice } from 'obsidian';

import type { OrchestratorPlan } from '../../../core/task/OrchestratorPlan';

export class OrchestratorPlanModal extends Modal {
  constructor(
    app: Modal['app'],
    private readonly plan: OrchestratorPlan,
    private readonly onApprove: () => Promise<void>,
    private readonly onReject: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Review orchestrator plan');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-orchestrator-plan-modal');
    contentEl.createDiv({ cls: 'claudian-orchestrator-plan-goal', text: this.plan.goal });

    const list = contentEl.createEl('ol', { cls: 'claudian-orchestrator-plan-list' });
    for (const subtask of this.plan.subtasks) {
      const item = list.createEl('li');
      item.createDiv({ text: subtask.title });
      item.createDiv({ cls: 'claudian-orchestrator-plan-description', text: subtask.description });
      if (subtask.dependsOn.length > 0) {
        item.createDiv({ cls: 'claudian-orchestrator-plan-dependencies', text: `Depends on: ${subtask.dependsOn.join(', ')}` });
      }
    }

    const actions = contentEl.createDiv({ cls: 'modal-button-container' });
    const reject = actions.createEl('button', { text: 'Reject plan' });
    reject.addEventListener('click', () => { void this.runAction(this.onReject); });
    const approve = actions.createEl('button', { text: 'Approve plan' });
    approve.addClass('mod-cta');
    approve.addEventListener('click', () => { void this.runAction(this.onApprove); });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Failed to update orchestrator plan');
    }
  }
}
