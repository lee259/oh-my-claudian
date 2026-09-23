import { type App, Modal, Notice, Setting } from 'obsidian';
import { h } from 'preact';

import type {
  AgentSkillDocument,
  AgentSkillInput,
  AgentSkillListResult,
} from '../../core/skills/AgentSkill';
import {
  AgentSkillCollisionError,
  AgentSkillRepositoryError,
  AgentSkillRevisionConflictError,
} from '../../core/skills/AgentSkillRepository';
import {
  AgentSkillValidationError,
  validateAgentSkillInput,
} from '../../core/skills/validateAgentSkill';
import {
  ManagedResourcePathError,
  ManagedResourceRelocationError,
} from '../../core/storage/VaultFileAdapter';
import type {
  AgentSkillManagementCoordinator,
  AgentSkillMutationResult,
} from '../../features/settings/AgentSkillManagementCoordinator';
import { t } from '../../i18n/i18n';
import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { type AgentSkillSettingsStatus,AgentSkillSettingsView } from './AgentSkillSettingsView';

type AgentSkillSaveHandler = (
  input: AgentSkillInput,
) => Promise<AgentSkillMutationResult<AgentSkillDocument>>;

function errorMessage(error: unknown): string {
  if (
    error instanceof AgentSkillRepositoryError
    || error instanceof ManagedResourcePathError
    || error instanceof ManagedResourceRelocationError
  ) {
    return error.message;
  }
  return 'Unexpected storage error';
}

function showSaveError(error: unknown, skillName: string): void {
  if (error instanceof AgentSkillRevisionConflictError) {
    new Notice(t('settings.agentSkills.staleConflict'));
    return;
  }
  if (error instanceof AgentSkillValidationError) {
    new Notice(t('settings.agentSkills.validationFailed', { message: error.message }));
    return;
  }
  if (error instanceof AgentSkillCollisionError) {
    new Notice(t('settings.agentSkills.collisionFailed', { name: skillName }));
    return;
  }
  new Notice(t('settings.agentSkills.saveFailed', { message: errorMessage(error) }));
}

export class AgentSkillModal extends Modal {
  private nameInput!: HTMLInputElement;
  private descriptionInput!: HTMLInputElement;
  private instructionsArea!: HTMLTextAreaElement;
  private triggerSave!: () => Promise<void>;

  constructor(
    app: App,
    private readonly existing: AgentSkillDocument | null,
    private readonly onSave: AgentSkillSaveHandler,
  ) {
    super(app);
  }

  getTestInputs(): {
    nameInput: HTMLInputElement;
    descriptionInput: HTMLInputElement;
    instructionsArea: HTMLTextAreaElement;
    triggerSave: () => Promise<void>;
  } {
    return {
      nameInput: this.nameInput,
      descriptionInput: this.descriptionInput,
      instructionsArea: this.instructionsArea,
      triggerSave: this.triggerSave,
    };
  }

  onOpen(): void {
    this.setTitle(t(this.existing
      ? 'settings.agentSkills.modal.titleEdit'
      : 'settings.agentSkills.modal.titleAdd'));
    this.modalEl.addClass('claudian-agent-skill-modal');

    new Setting(this.contentEl)
      .setName(t('settings.agentSkills.modal.name'))
      .setDesc(t('settings.agentSkills.modal.nameDesc'))
      .addText(text => {
        this.nameInput = text.inputEl;
        text
          .setValue(this.existing?.name ?? '')
          .setPlaceholder(t('settings.agentSkills.modal.namePlaceholder'));
      });

    new Setting(this.contentEl)
      .setName(t('settings.agentSkills.modal.description'))
      .setDesc(t('settings.agentSkills.modal.descriptionDesc'))
      .addText(text => {
        this.descriptionInput = text.inputEl;
        text
          .setValue(this.existing?.description ?? '')
          .setPlaceholder(t('settings.agentSkills.modal.descriptionPlaceholder'));
      });

    new Setting(this.contentEl)
      .setName(t('settings.agentSkills.modal.instructions'))
      .setDesc(t('settings.agentSkills.modal.instructionsDesc'));

    this.instructionsArea = this.contentEl.createEl('textarea', {
      cls: 'claudian-agent-skill-instructions',
      attr: {
        rows: '12',
        placeholder: t('settings.agentSkills.modal.instructionsPlaceholder'),
      },
    });
    this.instructionsArea.value = this.existing?.instructions ?? '';

    this.triggerSave = async (): Promise<void> => {
      const input: AgentSkillInput = {
        name: this.nameInput.value.trim(),
        description: this.descriptionInput.value.trim(),
        instructions: this.instructionsArea.value,
      };
      try {
        validateAgentSkillInput(input);
        const result = await this.onSave(input);
        if (result.refreshFailed) {
          new Notice(t('settings.agentSkills.savedRefreshFailed'));
        } else {
          new Notice(t(this.existing
            ? 'settings.agentSkills.updated'
            : 'settings.agentSkills.created', { name: result.value.name }));
        }
        this.close();
      } catch (error) {
        showSaveError(error, input.name);
      }
    };

    const actions = this.contentEl.createDiv({ cls: 'claudian-agent-skill-modal-actions' });
    const cancelButton = actions.createEl('button', {
      text: t('common.cancel'),
      cls: 'claudian-cancel-btn',
    });
    cancelButton.addEventListener('click', () => this.close());
    const saveButton = actions.createEl('button', {
      text: t('common.save'),
      cls: 'claudian-save-btn',
    });
    saveButton.addEventListener('click', () => {
      void this.triggerSave();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class AgentSkillDeleteModal extends Modal {
  private triggerDelete!: () => Promise<void>;

  constructor(
    app: App,
    private readonly skill: AgentSkillDocument,
    private readonly onDelete: () => Promise<AgentSkillMutationResult<void>>,
  ) {
    super(app);
  }

  getTestTrigger(): () => Promise<void> {
    return this.triggerDelete;
  }

  onOpen(): void {
    this.setTitle(t('settings.agentSkills.delete.title'));
    this.contentEl.createEl('p', {
      text: t('settings.agentSkills.delete.description'),
      cls: 'claudian-agent-skill-delete-description',
    });
    this.contentEl.createEl('code', { text: this.skill.directoryPath });

    this.triggerDelete = async (): Promise<void> => {
      try {
        const result = await this.onDelete();
        if (result.refreshFailed) {
          new Notice(t('settings.agentSkills.savedRefreshFailed'));
        } else {
          new Notice(t('settings.agentSkills.deleted', { name: this.skill.name }));
        }
        this.close();
      } catch (error) {
        if (error instanceof AgentSkillRevisionConflictError) {
          new Notice(t('settings.agentSkills.staleConflict'));
          return;
        }
        new Notice(t('settings.agentSkills.deleteFailed', { message: errorMessage(error) }));
      }
    };

    const actions = this.contentEl.createDiv({ cls: 'claudian-agent-skill-modal-actions' });
    const cancelButton = actions.createEl('button', {
      text: t('common.cancel'),
      cls: 'claudian-cancel-btn',
    });
    cancelButton.addEventListener('click', () => this.close());
    const deleteButton = actions.createEl('button', {
      text: t('settings.agentSkills.delete.confirm'),
      cls: 'mod-warning',
    });
    deleteButton.addEventListener('click', () => {
      void this.triggerDelete();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const agentSkillDisposers = new WeakMap<HTMLElement, () => void>();

/** Unmount embedded Agent Skills views before provider settings are cleared. */
export function destroyAgentSkillSettings(container: HTMLElement): void {
  const roots = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-agent-skills-manager'),
  );
  if (container.classList.contains('claudian-agent-skills-manager')) {
    roots.unshift(container);
  }
  roots.forEach(root => agentSkillDisposers.get(root)?.());
}

export class AgentSkillSettings {
  private renderGeneration = 0;
  private readonly rootEl: HTMLDivElement;
  private readonly root: PreactRoot;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private status: AgentSkillSettingsStatus = 'loading';
  private skills: AgentSkillListResult['skills'] = [];
  private diagnostics: AgentSkillListResult['diagnostics'] = [];

  constructor(
    containerEl: HTMLElement,
    private readonly coordinator: AgentSkillManagementCoordinator,
    private readonly app: App,
  ) {
    this.rootEl = containerEl.createDiv({ cls: 'claudian-agent-skills-manager' });
    this.root = createPreactRoot(this.rootEl);
    this.unsubscribe = coordinator.subscribe(() => {
      void this.render();
    });
    agentSkillDisposers.set(this.rootEl, () => this.dispose());
    void this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderGeneration++;
    agentSkillDisposers.delete(this.rootEl);
    this.unsubscribe();
    this.root.unmount();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.renderGeneration;
    this.status = 'loading';
    this.renderView();

    let result: AgentSkillListResult;
    try {
      result = await this.coordinator.list();
    } catch {
      if (this.disposed || generation !== this.renderGeneration) return;
      this.status = 'error';
      this.renderView();
      return;
    }
    if (this.disposed || generation !== this.renderGeneration) return;

    this.skills = result.skills;
    this.diagnostics = result.diagnostics;
    this.status = 'ready';
    this.renderView();
  }

  private renderView(): void {
    if (this.disposed) return;
    this.root.render(h(AgentSkillSettingsView, {
      status: this.status,
      skills: this.skills,
      diagnostics: this.diagnostics,
      onRefresh: () => { void this.render(); },
      onAdd: () => this.openEditModal(null),
      onEdit: skill => this.openEditModal(skill),
      onDelete: skill => this.openDeleteModal(skill),
    }));
  }

  private openEditModal(existing: AgentSkillDocument | null): void {
    const modal = new AgentSkillModal(this.app, existing, input => (
      existing
        ? this.coordinator.update(existing.name, existing.revision, input)
        : this.coordinator.create(input)
    ));
    modal.open();
  }

  private openDeleteModal(skill: AgentSkillDocument): void {
    const modal = new AgentSkillDeleteModal(
      this.app,
      skill,
      () => this.coordinator.trash(skill.name, skill.revision),
    );
    modal.open();
  }
}
