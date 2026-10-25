import type { App, ToggleComponent } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderVaultEntryRepository } from '../../../core/providers/commands/ProviderVaultEntryRepository';
import { t } from '../../../i18n/i18n';
import { extractFirstParagraph, normalizeArgumentHint, parseSlashCommandContent, validateCommandName } from '../../../utils/slashCommand';

function resolveAllowedTools(inputValue: string, parsedTools?: string[]): string[] | undefined {
  const trimmed = inputValue.trim();
  if (trimmed) {
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (parsedTools && parsedTools.length > 0) {
    return parsedTools;
  }
  return undefined;
}

function isSkillEntry(entry: ProviderCommandEntry): boolean {
  return entry.kind === 'skill';
}

export class SlashCommandModal extends Modal {
  private entries: ProviderCommandEntry[];
  private existingEntry: ProviderCommandEntry | null;
  private onSave: (entry: ProviderCommandEntry) => Promise<void>;

  constructor(
    app: App,
    entries: ProviderCommandEntry[],
    existingEntry: ProviderCommandEntry | null,
    onSave: (entry: ProviderCommandEntry) => Promise<void>,
  ) {
    super(app);
    this.entries = entries;
    this.existingEntry = existingEntry;
    this.onSave = onSave;
  }

  onOpen() {
    const existingIsSkill = this.existingEntry ? isSkillEntry(this.existingEntry) : false;
    let selectedType: 'command' | 'skill' = existingIsSkill ? 'skill' : 'command';

    const typeLabel = () => selectedType === 'skill' ? t('settings.slashCommands.typeSkill') : t('settings.slashCommands.typeCommand');

    this.setTitle(t(this.existingEntry ? 'settings.slashCommands.editTitle' : 'settings.slashCommands.addTitle', { type: typeLabel() }));
    this.modalEl.addClass('claudian-sp-modal');

    const { contentEl } = this;

    let nameInput: HTMLInputElement;
    let descInput: HTMLInputElement;
    let hintInput: HTMLInputElement;
    let modelInput: HTMLInputElement;
    let toolsInput: HTMLInputElement;
    let disableModelToggle = this.existingEntry?.disableModelInvocation ?? false;
    let disableUserInvocation = this.existingEntry?.userInvocable === false;
    let contextValue: 'fork' | '' = this.existingEntry?.context ?? '';
    let agentInput: HTMLInputElement;

    let disableUserSetting: Setting | null = null;
    let disableUserToggle: ToggleComponent | null = null;

    const updateSkillOnlyFields = () => {
      if (!disableUserSetting || !disableUserToggle) return;

      const isSkillType = selectedType === 'skill';
      disableUserSetting.settingEl.toggleClass('claudian-hidden', !isSkillType);
      if (!isSkillType) {
        disableUserInvocation = false;
        disableUserToggle.setValue(false);
      }
    };

    new Setting(contentEl)
      .setName(t('settings.mcp.type'))
      .setDesc(t('settings.slashCommands.typeDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('command', t('settings.slashCommands.command'))
          .addOption('skill', t('settings.slashCommands.typeSkill'))
          .setValue(selectedType)
          .onChange(value => {
            selectedType = value as 'command' | 'skill';
            this.setTitle(t(this.existingEntry ? 'settings.slashCommands.editTitle' : 'settings.slashCommands.addTitle', { type: typeLabel() }));
            updateSkillOnlyFields();
          });
        if (this.existingEntry) {
          dropdown.setDisabled(true);
        }
      });

    new Setting(contentEl)
      .setName(t('settings.slashCommands.commandName'))
      .setDesc(t('settings.slashCommands.commandNameDesc'))
      .addText(text => {
        nameInput = text.inputEl;
        text.setValue(this.existingEntry?.name || '')
          .setPlaceholder('Review-code');
      });

    new Setting(contentEl)
      .setName(t('common.description'))
      .setDesc(t('settings.slashCommands.descriptionDesc'))
      .addText(text => {
        descInput = text.inputEl;
        text.setValue(this.existingEntry?.description || '');
      });

    const details = contentEl.createEl('details', { cls: 'claudian-sp-advanced-section' });
    details.createEl('summary', {
      text: t('settings.subagents.modal.advancedOptions'),
      cls: 'claudian-sp-advanced-summary',
    });
    if (
      this.existingEntry?.argumentHint
      || this.existingEntry?.model
      || this.existingEntry?.allowedTools?.length
      || this.existingEntry?.disableModelInvocation
      || this.existingEntry?.userInvocable === false
      || this.existingEntry?.context
      || this.existingEntry?.agent
    ) {
      details.open = true;
    }

    new Setting(details)
      .setName(t('settings.slashCommands.argumentHint'))
      .setDesc(t('settings.slashCommands.argumentHintDesc'))
      .addText(text => {
        hintInput = text.inputEl;
        text.setValue(this.existingEntry?.argumentHint || '');
      });

    new Setting(details)
      .setName(t('settings.slashCommands.modelOverride'))
      .setDesc(t('settings.slashCommands.modelDesc'))
      .addText(text => {
        modelInput = text.inputEl;
        text.setValue(this.existingEntry?.model || '')
          .setPlaceholder('Claude-sonnet-4-5');
      });

    new Setting(details)
      .setName(t('settings.slashCommands.allowedTools'))
      .setDesc(t('settings.slashCommands.allowedToolsDesc'))
      .addText(text => {
        toolsInput = text.inputEl;
        text.setValue(this.existingEntry?.allowedTools?.join(', ') || '');
      });

    new Setting(details)
      .setName(t('settings.slashCommands.disableModel'))
      .setDesc(t('settings.slashCommands.disableModelDesc'))
      .addToggle(toggle => {
        toggle.setValue(disableModelToggle)
          .onChange(value => { disableModelToggle = value; });
      });

    disableUserSetting = new Setting(details)
      .setName(t('settings.slashCommands.disableUser'))
      .setDesc(t('settings.slashCommands.disableUserDesc'))
      .addToggle(toggle => {
        disableUserToggle = toggle;
        toggle.setValue(disableUserInvocation)
          .onChange(value => { disableUserInvocation = value; });
      });

    updateSkillOnlyFields();

    new Setting(details)
      .setName(t('settings.slashCommands.context'))
      .setDesc(t('settings.slashCommands.contextDesc'))
      .addToggle(toggle => {
        toggle.setValue(contextValue === 'fork')
          .onChange(value => {
            contextValue = value ? 'fork' : '';
            agentSetting.settingEl.toggleClass('claudian-hidden', !value);
          });
      });

    const agentSetting = new Setting(details)
      .setName(t('settings.slashCommands.agent'))
      .setDesc(t('settings.slashCommands.agentDesc'))
      .addText(text => {
        agentInput = text.inputEl;
        text.setValue(this.existingEntry?.agent || '')
          .setPlaceholder('Code-reviewer');
      });
    agentSetting.settingEl.toggleClass('claudian-hidden', contextValue !== 'fork');

    new Setting(contentEl)
      .setName(t('settings.slashCommands.promptTemplate'))
      .setDesc(t('settings.slashCommands.promptDesc'));

    const contentArea = contentEl.createEl('textarea', {
      cls: 'claudian-sp-content-area',
      attr: {
        rows: '10',
        placeholder: t('settings.slashCommands.promptPlaceholder'),
      },
    });
    const initialContent = this.existingEntry
      ? parseSlashCommandContent(this.existingEntry.content).promptContent
      : '';
    contentArea.value = initialContent;

    const buttonContainer = contentEl.createDiv({ cls: 'claudian-sp-modal-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('common.cancel'),
      cls: 'claudian-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: t('common.save'),
      cls: 'claudian-save-btn',
    });
    saveBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
      const name = nameInput.value.trim();
      const nameError = validateCommandName(name);
      if (nameError) {
        new Notice(nameError);
        return;
      }

      const content = contentArea.value;
      if (!content.trim()) {
        new Notice(t('settings.slashCommands.promptRequired'));
        return;
      }

      const existing = this.entries.find(
        entry => entry.name.toLowerCase() === name.toLowerCase()
          && entry.id !== this.existingEntry?.id,
      );
      if (existing) {
        new Notice(t('settings.slashCommands.duplicate', { name }));
        return;
      }

      const parsed = parseSlashCommandContent(content);
      const promptContent = parsed.promptContent;
      const isSkillType = selectedType === 'skill';

      const entry: ProviderCommandEntry = {
        id: this.existingEntry?.id || (
          isSkillType
            ? `skill-${name}`
            : `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
        ),
        providerId: 'claude',
        kind: isSkillType ? 'skill' : 'command',
        name,
        description: descInput.value.trim() || parsed.description || undefined,
        argumentHint: normalizeArgumentHint(hintInput.value.trim()) || parsed.argumentHint || undefined,
        allowedTools: resolveAllowedTools(toolsInput.value, parsed.allowedTools),
        model: modelInput.value.trim() || parsed.model || undefined,
        content: promptContent,
        disableModelInvocation: disableModelToggle || undefined,
        userInvocable: disableUserInvocation ? false : undefined,
        context: contextValue || undefined,
        agent: contextValue === 'fork' ? (agentInput.value.trim() || undefined) : undefined,
        hooks: parsed.hooks ?? this.existingEntry?.hooks,
        scope: 'vault',
        source: this.existingEntry?.source ?? 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
        persistenceKey: this.existingEntry?.persistenceKey,
      };

      try {
        await this.onSave(entry);
      } catch {
        new Notice(t(isSkillType ? 'settings.slashCommands.saveSkillFailed' : 'settings.slashCommands.saveCommandFailed'));
        return;
      }
      this.close();
      })();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    contentEl.addEventListener('keydown', handleKeyDown);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class SlashCommandSettings {
  private app: App;
  private containerEl: HTMLElement;
  private repository: ProviderVaultEntryRepository | null;
  private commands: ProviderCommandEntry[] = [];

  constructor(
    containerEl: HTMLElement,
    app: App,
    repository: ProviderVaultEntryRepository | null,
  ) {
    this.app = app;
    this.containerEl = containerEl;
    this.repository = repository;
    void this.loadAndRender();
  }

  private async loadAndRender(): Promise<void> {
    if (!this.repository) {
      this.renderUnavailable();
      return;
    }

    this.commands = await this.repository.listVaultEntries();
    this.render();
  }

  private renderUnavailable(): void {
    this.containerEl.empty();
    const emptyEl = this.containerEl.createDiv({ cls: 'claudian-sp-empty-state' });
    emptyEl.setText(t('settings.slashCommands.unavailable'));
  }

  private render(): void {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-sp-header' });
    headerEl.createSpan({ text: t('settings.slashCommands.name'), cls: 'claudian-sp-label' });

    const actionsEl = headerEl.createDiv({ cls: 'claudian-sp-header-actions' });

    const addBtn = actionsEl.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': t('common.add') },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openCommandModal(null));

    if (this.commands.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-sp-empty-state' });
      emptyEl.setText(t('settings.slashCommands.empty'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-sp-list' });

    for (const cmd of this.commands) {
      this.renderCommandItem(listEl, cmd);
    }
  }

  private renderCommandItem(listEl: HTMLElement, cmd: ProviderCommandEntry): void {
    const itemEl = listEl.createDiv({ cls: 'claudian-sp-item' });

    const infoEl = itemEl.createDiv({ cls: 'claudian-sp-info' });

    const headerRow = infoEl.createDiv({ cls: 'claudian-sp-item-header' });

    const nameEl = headerRow.createSpan({ cls: 'claudian-sp-item-name' });
    nameEl.setText(`/${cmd.name}`);

    if (isSkillEntry(cmd)) {
      headerRow.createSpan({ text: t('settings.slashCommands.badge'), cls: 'claudian-slash-item-badge' });
    }

    if (cmd.argumentHint) {
      const hintEl = headerRow.createSpan({ cls: 'claudian-slash-item-hint' });
      hintEl.setText(cmd.argumentHint);
    }

    if (cmd.description) {
      const descEl = infoEl.createDiv({ cls: 'claudian-sp-item-desc' });
      descEl.setText(cmd.description);
    }

    const actionsEl = itemEl.createDiv({ cls: 'claudian-sp-item-actions' });

    if (cmd.isEditable) {
      const editBtn = actionsEl.createEl('button', {
        cls: 'claudian-settings-action-btn',
        attr: { 'aria-label': t('common.edit') },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', () => this.openCommandModal(cmd));
    }

    if (!isSkillEntry(cmd) && cmd.isEditable) {
      const convertBtn = actionsEl.createEl('button', {
        cls: 'claudian-settings-action-btn',
        attr: { 'aria-label': t('settings.slashCommands.convert') },
      });
      setIcon(convertBtn, 'package');
      convertBtn.addEventListener('click', () => {
        void (async (): Promise<void> => {
        try {
          await this.transformToSkill(cmd);
        } catch {
          new Notice(t('settings.slashCommands.convertFailed'));
        }
        })();
      });
    }

    if (cmd.isDeletable) {
      const deleteBtn = actionsEl.createEl('button', {
        cls: 'claudian-settings-action-btn claudian-settings-delete-btn',
        attr: { 'aria-label': t('common.delete') },
      });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', () => {
        void (async (): Promise<void> => {
        try {
          await this.deleteCommand(cmd);
        } catch {
          new Notice(t(isSkillEntry(cmd) ? 'settings.slashCommands.deleteSkillFailed' : 'settings.slashCommands.deleteCommandFailed'));
        }
        })();
      });
    }
  }

  private openCommandModal(existingCmd: ProviderCommandEntry | null): void {
    const modal = new SlashCommandModal(
      this.app,
      this.commands,
      existingCmd,
      async (cmd) => {
        await this.saveCommand(cmd, existingCmd);
      },
    );
    modal.open();
  }

  private async saveCommand(cmd: ProviderCommandEntry, existing: ProviderCommandEntry | null): Promise<void> {
    if (!this.repository) {
      return;
    }

    await this.repository.saveVaultEntry(cmd);

    if (existing && existing.name !== cmd.name) {
      await this.repository.deleteVaultEntry(existing);
    }

    await this.reloadCommands();

    this.render();
    const label = isSkillEntry(cmd) ? t('settings.slashCommands.typeSkill') : t('settings.slashCommands.entryCommand');
    new Notice(t(existing ? 'settings.slashCommands.updated' : 'settings.slashCommands.created', { type: label, name: cmd.name }));
  }

  private async deleteCommand(cmd: ProviderCommandEntry): Promise<void> {
    if (!this.repository) {
      return;
    }

    await this.repository.deleteVaultEntry(cmd);

    await this.reloadCommands();

    this.render();
    const label = isSkillEntry(cmd) ? t('settings.slashCommands.typeSkill') : t('settings.slashCommands.entryCommand');
    new Notice(t('settings.slashCommands.deleted', { type: label, name: cmd.name }));
  }

  private async transformToSkill(cmd: ProviderCommandEntry): Promise<void> {
    if (!this.repository) {
      return;
    }

    const skillName = cmd.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);

    const existingSkill = this.commands.find(
      entry => isSkillEntry(entry) && entry.name === skillName,
    );
    if (existingSkill) {
      new Notice(t('settings.slashCommands.duplicateSkill', { name: skillName }));
      return;
    }

    const skill: ProviderCommandEntry = {
      ...cmd,
      id: `skill-${skillName}`,
      kind: 'skill',
      name: skillName,
      description: cmd.description || extractFirstParagraph(cmd.content),
      source: 'user',
      scope: 'vault',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
    };

    await this.repository.saveVaultEntry(skill);
    await this.repository.deleteVaultEntry(cmd);

    await this.reloadCommands();
    this.render();
    new Notice(t('settings.slashCommands.converted', { name: cmd.name }));
  }

  private async reloadCommands(): Promise<void> {
    if (!this.repository) {
      this.commands = [];
      return;
    }

    this.commands = await this.repository.listVaultEntries();
  }

  public refresh(): void {
    void this.loadAndRender();
  }
}
