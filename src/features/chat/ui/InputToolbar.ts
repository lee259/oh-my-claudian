import * as fs from 'fs';
import { Notice } from 'obsidian';
import * as os from 'os';
import * as path from 'path';
import { h } from 'preact';

import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderId,
  ProviderModeSelectorConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ManagedMcpServer,
  UsageInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { appendCheckIcon, appendMcpIcon } from '../../../shared/icons';
import { createPreactRoot, type PreactRoot } from '../../../shared/ui/PreactRoot';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { filterValidPaths, findConflictingPath, getFolderName, isDuplicatePath, isValidDirectoryPath, validateDirectoryPath, validateFilePath } from '../../../utils/externalContext';
import { expandHomePath, normalizePathForFilesystem } from '../../../utils/path';
import { toggleServiceTier } from '../actions/toggleServiceTier';
import type { ComposerContextTray } from './ComposerContextTray';
import { ExternalContextSelectorView } from './ExternalContextSelectorView';
import { type InputToolbarSlot, InputToolbarView } from './InputToolbarView';
import { ModelSelectorView } from './ModelSelectorView';
import type { PermissionModeMenuOption } from './PermissionModeMenuView';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: { properties: string[]; title: string }): Promise<ElectronOpenDialogResult>;
  };
}

let nextPermissionModeMenuId = 0;

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

function localizePathValidationError(error: string | undefined): string {
  switch (error) {
    case 'Path does not exist':
      return t('chat.composer.externalContextPathNotFound');
    case 'Permission denied':
      return t('chat.composer.externalContextPermissionDenied');
    case 'Path exists but is not a directory':
      return t('chat.composer.externalContextPathNotDirectory');
    case 'Path exists but is not a file':
      return t('chat.composer.externalContextPathNotFile');
    default: {
      const prefix = 'Cannot access path: ';
      if (error?.startsWith(prefix)) {
        return t('chat.composer.externalContextCannotAccessPath', { error: error.slice(prefix.length) });
      }
      return error ?? '';
    }
  }
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string, providerId?: ProviderId) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onServiceTierChange: (serviceTier: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  onAddContext?: () => void;
  onExternalFilesSelected?: (paths: string[]) => void;
  onContextPathActivate?: (path: string) => void;
  onCloseContextActionsMenu?: () => void;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ProviderChatUIConfig;
  getCapabilities: () => ProviderCapabilities;
}

export interface PermissionModeMenuHandle {
  updateDisplay: () => void;
  setVisible: (visible: boolean) => void;
  canCycle?: () => boolean;
  cycleMode?: (onSelect?: (mode: string) => void) => boolean;
}

export class ModelSelector {
  private readonly root: PreactRoot;
  private readonly callbacks: ToolbarCallbacks;
  private readonly menuId = `claudian-model-menu-${++nextPermissionModeMenuId}`;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.root = createPreactRoot(parentEl);
    this.updateDisplay();
  }

  destroy(): void {
    this.root.unmount();
  }

  updateDisplay(): void {
    const settings = this.callbacks.getSettings();
    const uiConfig = this.callbacks.getUIConfig();
    const models = uiConfig.getModelOptions({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
    const currentModel = settings.model;
    const displayModel = models.find(model => model.value === currentModel);
    const displayModelLabel = displayModel?.label ?? (currentModel ? 'Model unavailable' : 'Choose a model');

    const adaptiveReasoning = uiConfig.isAdaptiveReasoningModel(currentModel, settings);
    const reasoningOptions = this.callbacks.getCapabilities().reasoningControl === 'none'
      ? []
      : uiConfig.getReasoningOptions(currentModel, settings);
    const reasoningValue = adaptiveReasoning ? settings.effortLevel : settings.thinkingBudget;
    const serviceTier = uiConfig.getServiceTierToggle?.(settings) ?? null;
    const serviceTierActive = serviceTier
      ? serviceTier.isActive ?? settings.serviceTier === serviceTier.activeValue
      : false;

    this.root.render(h(ModelSelectorView, {
      id: this.menuId,
      models,
      currentModel,
      displayModelLabel,
      providerIcon: displayModel?.providerIcon ?? uiConfig.getProviderIcon?.() ?? undefined,
      modelTitle: displayModel ? '' : 'Choose an enabled model in provider settings.',
      reasoningOptions,
      reasoningValue,
      reasoningDefaultValue: uiConfig.getDefaultReasoningValue(currentModel, settings),
      reasoningLabel: adaptiveReasoning ? 'Effort' : 'Thinking budget',
      serviceTier,
      serviceTierActive,
      onModelChange: model => runToolbarAction(async () => {
        await this.callbacks.onModelChange(model.value, model.providerId);
        this.updateDisplay();
      }, 'Failed to change model'),
      onReasoningChange: value => runToolbarAction(async () => {
        try {
          if (adaptiveReasoning) await this.callbacks.onEffortLevelChange(value);
          else await this.callbacks.onThinkingBudgetChange(value);
        } finally {
          this.updateDisplay();
        }
      }, adaptiveReasoning ? 'Failed to change effort level' : 'Failed to change thinking budget'),
      onServiceTierToggle: () => runToolbarAction(async () => {
        await toggleServiceTier(this.callbacks);
        this.updateDisplay();
      }, 'Failed to change service tier'),
    }));
  }

  renderOptions(): void {
    this.updateDisplay();
  }
}

export class ModeSelector {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private toggleEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-mode-selector' });
    this.render();
  }

  private getSelectorConfig(): ProviderModeSelectorConfig | null {
    return this.callbacks.getUIConfig().getModeSelector?.(this.callbacks.getSettings()) ?? null;
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'claudian-mode-label' });
    this.toggleEl = this.container.createDiv({ cls: 'claudian-toggle-switch' });

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change mode');
    });

    this.updateDisplay();
  }

  /** Resolves the active/inactive option pair for a two-option toggle. */
  private resolveOptionPair(
    selectorConfig: ProviderModeSelectorConfig,
  ): { active: ProviderUIOption; inactive: ProviderUIOption } {
    const [first, second] = selectorConfig.options;
    const active = selectorConfig.activeValue
      ? selectorConfig.options.find((option) => option.value === selectorConfig.activeValue) ?? second
      : second;
    const inactive = active.value === first.value ? second : first;
    return { active, inactive };
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) {
      return;
    }

    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    const isActive = currentOption.value === active.value;

    this.labelEl.setText(currentOption.label || selectorConfig.label);
    this.labelEl.toggleClass('active', isActive);
    if (isActive) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    const titleParts = [`${inactive.label} <-> ${active.label}`];
    if (currentOption.description) {
      titleParts.push(currentOption.description);
    }
    this.container.setAttribute('title', titleParts.join('\n'));
  }

  renderOptions() {
    this.updateDisplay();
  }

  private async toggle() {
    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      return;
    }

    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const nextValue = selectorConfig.value === active.value ? inactive.value : active.value;
    await this.callbacks.onModeChange(nextValue);
    this.updateDisplay();
  }
}

export class ThinkingBudgetSelector {
  private disposed = false;

  constructor(
    _parentEl: HTMLElement,
    _callbacks: ToolbarCallbacks,
    private readonly modelSelector?: ModelSelector,
  ) {}

  destroy(): void {
    this.disposed = true;
  }

  updateDisplay(): void {
    if (!this.disposed) this.modelSelector?.updateDisplay();
  }
}

export class ServiceTierToggle {
  private disposed = false;

  constructor(
    _parentEl: HTMLElement,
    private readonly callbacks: ToolbarCallbacks,
    private readonly modelSelector?: ModelSelector,
  ) {}

  updateDisplay(): void {
    if (!this.disposed) this.modelSelector?.updateDisplay();
  }

  async toggle(): Promise<boolean> {
    const toggled = await toggleServiceTier(this.callbacks);
    if (toggled) this.updateDisplay();
    return toggled;
  }
}

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

export class ExternalContextSelector {
  private readonly root: PreactRoot;
  private dropdownOpen = false;
  private callbacks: ToolbarCallbacks;
  private contextTray: ComposerContextTray | null = null;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(
    parentEl: HTMLElement,
    callbacks: ToolbarCallbacks,
  ) {
    this.callbacks = callbacks;
    this.root = createPreactRoot(parentEl);
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  setContextTray(contextTray: ComposerContextTray): void {
    if (this.contextTray && this.contextTray !== contextTray) {
      this.contextTray.clearItems('external-contexts');
    }
    this.contextTray = contextTray;
    this.renderContextTrayItems();
  }

  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent directories
    const validPaths = filterValidPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(t('chat.composer.externalContextInvalidPathsRemoved', {
        count: invalidPaths.length,
        paths: pathNames,
      }), 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate path still exists before persisting
      if (!isValidDirectoryPath(path)) {
        new Notice(t('chat.composer.externalContextCannotPersist', { path: this.shortenPath(path) }), 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.render();
  }

  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved conversation.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
  }

  /**
   * Add an external context path programmatically (e.g., from /add-dir command).
   * Validates the path and handles duplicates/conflicts.
   * @param pathInput - Path string (supports ~/ expansion)
   * @returns Result with success status and normalized path, or error message on failure
   */
  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: t('chat.composer.externalContextNoPath') };
    }

    // Strip surrounding quotes if present (e.g., "/path/with spaces")
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Expand home directory and normalize path
    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: t('chat.composer.externalContextPathMustBeAbsolute') };
    }

    // Validate path exists and is a directory with specific error messages
    const validation = validateDirectoryPath(normalizedPath);
    if (!validation.valid) {
      return {
        success: false,
        error: t('chat.composer.externalContextPathValidation', {
          reason: localizePathValidationError(validation.error),
          path: pathInput,
        }),
      };
    }

    // Check for duplicate (normalized comparison for cross-platform support)
    if (isDuplicatePath(normalizedPath, this.externalContextPaths)) {
      return { success: false, error: t('chat.composer.externalContextAlreadyAdded') };
    }

    // Check for nested/overlapping paths
    const conflict = findConflictingPath(normalizedPath, this.externalContextPaths);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    // Add the path
    this.externalContextPaths = [...this.externalContextPaths, normalizedPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();

    return { success: true, normalizedPath };
  }

  /**
   * Clear session-only external context paths (call on new conversation).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
  }

  closeDropdown(): void {
    this.setDropdownOpen(false);
  }

  private setDropdownOpen(open: boolean): void {
    this.dropdownOpen = open && this.externalContextPaths.length > 0;
    this.render();
  }

  private async openContextPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
      const { remote } = require('electron') as { remote?: ElectronRemoteApi };
      if (!remote) {
        throw new Error('Electron remote API is unavailable');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        title: t('chat.composer.externalContextPickerTitle'),
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedFiles = new Set<string>();
        for (const selectedPath of result.filePaths) {
          const normalizedPath = normalizePathForFilesystem(selectedPath);
          try {
            const stats = fs.statSync(normalizedPath);
            if (stats.isDirectory()) {
              const added = this.addExternalContext(normalizedPath);
              if (!added.success) new Notice(added.error, 5000);
            } else if (stats.isFile()) {
              const validation = validateFilePath(normalizedPath);
              if (validation.valid) selectedFiles.add(normalizedPath);
              else new Notice(t('chat.composer.externalContextPathValidation', {
                reason: localizePathValidationError(validation.error),
                path: selectedPath,
              }), 5000);
            } else {
              new Notice(t('chat.composer.externalContextSelectedPathNotFileOrFolder', { path: selectedPath }), 5000);
            }
          } catch {
            new Notice(t('chat.composer.externalContextCannotAccessSelectedPath', { path: selectedPath }), 5000);
          }
        }
        if (selectedFiles.size > 0) {
          this.callbacks.onExternalFilesSelected?.([...selectedFiles]);
        }
      }
    } catch {
      new Notice(t('chat.composer.externalContextOpenPickerFailed'), 5000);
    }
  }

  /** Formats a conflict error message for display. */
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? t('chat.composer.externalContextNestedPath', { path: shortNew, existing: shortExisting })
      : t('chat.composer.externalContextContainsExistingPath', { path: shortNew, existing: shortExisting });
  }

  destroy(): void {
    this.contextTray?.clearItems('external-contexts');
    this.contextTray = null;
    this.root.unmount();
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull === compareHome) return '~';
      const homePrefix = compareHome.endsWith('/') ? compareHome : `${compareHome}/`;
      if (compareFull.startsWith(homePrefix)) {
        const remainder = normalizedFull.slice(normalizedHome.length).replace(/^\/+/, '');
        return `~/${remainder}`;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (this.externalContextPaths.length === 0) this.dropdownOpen = false;
    this.render();
  }

  refreshLocale(): void {
    this.render();
  }

  private render(): void {
    this.renderContextTrayItems();
    const entries = this.externalContextPaths.map((contextPath) => {
      const normalizedPath = contextPath.replace(/\\/g, '/').replace(/\/+$/, '');
      return {
        path: contextPath,
        name: getFolderName(contextPath),
        parentPath: this.shortenPath(path.dirname(normalizedPath)),
        persistent: this.persistentPaths.has(contextPath),
      };
    });
    this.root.render(h(ExternalContextSelectorView, {
      addFilesAndFoldersLabel: t('chat.composer.externalFilesAndFolders'),
      manageLabel: t('chat.composer.manageExternalFolders'),
      managerTitle: t('chat.composer.externalContextManagerTitle'),
      managerDescription: t('chat.composer.externalContextManagerDescription'),
      entries,
      managerOpen: this.dropdownOpen,
      acrossSessionsLabel: t('chat.composer.externalContextAcrossSessions'),
      thisConversationLabel: t('chat.composer.externalContextThisConversation'),
      persistLabel: t('chat.composer.persistExternalFolder'),
      sessionOnlyLabel: t('chat.composer.makeExternalFolderSessionOnly'),
      removeLabel: t('chat.composer.removeExternalFolder'),
      emptyLabel: t('chat.composer.externalContextNoFolders'),
      onPickFilesAndFolders: () => {
        this.setDropdownOpen(false);
        this.callbacks.onCloseContextActionsMenu?.();
        void this.openContextPicker();
      },
      onToggleManager: () => this.setDropdownOpen(!this.dropdownOpen),
      onTogglePersistence: (contextPath: string) => this.togglePersistence(contextPath),
      onRemove: (contextPath: string) => this.removePath(contextPath),
    }));
  }

  private renderContextTrayItems(): void {
    if (!this.contextTray) return;
    this.contextTray.setItems('external-contexts', this.externalContextPaths.map((contextPath) => {
      const label = getFolderName(contextPath);
      return {
        id: contextPath,
        kind: 'folder' as const,
        label,
        icon: 'folder',
        title: contextPath,
        ariaLabel: `${t('chat.composer.externalContextManagerTitle')}: ${label}`,
        removeLabel: t('chat.composer.removeExternalFolder'),
        onActivate: () => this.callbacks.onContextPathActivate?.(contextPath),
        onRemove: () => this.removePath(contextPath),
      };
    }));
  }
}

let nextMcpSelectorId = 0;

export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpManager: McpServerManager | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private visible = true;
  private isOpen = false;

  private readonly handleDocumentClick = (event: MouseEvent): void => {
    if (!this.container.contains(event.target as Node)) this.setOpen(false);
  };

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'claudian-mcp-selector' });
    this.render();
    this.container.ownerDocument.addEventListener('click', this.handleDocumentClick, true);
  }

  destroy(): void {
    this.container.ownerDocument.removeEventListener('click', this.handleDocumentClick, true);
    this.setOpen(false);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) {
      this.enabledServers.clear();
      this.onChangeCallback?.(this.enabledServers);
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
    this.ensureManagerLoaded(manager);
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    if (this.mcpManager.isLoaded?.() === false) return;
    const activeNames = new Set(this.mcpManager.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private ensureManagerLoaded(manager: McpServerManager | null): void {
    if (!manager || manager.isLoaded?.() !== false) return;

    const load = manager.ensureLoaded?.();
    if (load === undefined) return;

    void load.then(() => {
      if (this.mcpManager !== manager) return;
      this.updateDisplay();
      this.renderDropdown();
    }).catch(() => {
      // Keep the selector hidden when its configuration cannot be loaded.
    });
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createEl('button', {
      cls: 'claudian-mcp-selector-icon-wrapper',
      attr: {
        type: 'button',
        'aria-label': t('settings.mcpServers.name'),
        'aria-expanded': 'false',
      },
    });

    this.iconEl = iconWrapper.createDiv({ cls: 'claudian-mcp-selector-icon' });
    appendMcpIcon(this.iconEl);

    this.badgeEl = iconWrapper.createDiv({ cls: 'claudian-mcp-selector-badge' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'claudian-mcp-selector-dropdown' });
    this.dropdownEl.id = `claudian-mcp-selector-${++nextMcpSelectorId}`;
    iconWrapper.setAttribute('aria-controls', this.dropdownEl.id);
    this.renderDropdown();
    iconWrapper.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.isOpen);
    });

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      const load = this.mcpManager?.ensureLoaded?.();
      if (load) {
        void load.then(() => {
          this.updateDisplay();
          this.renderDropdown();
        }).catch(() => {
          // Keep the selector usable with its last known state when config loading fails.
        });
      } else {
        this.renderDropdown();
      }
    });
  }

  private setOpen(open: boolean): void {
    this.isOpen = open;
    this.container.classList.toggle('is-open', open);
    const trigger = this.container.querySelector<HTMLButtonElement>('.claudian-mcp-selector-icon-wrapper');
    trigger?.setAttribute('aria-expanded', String(open));
    if (open) {
      this.dropdownEl?.querySelector<HTMLElement>('.claudian-mcp-selector-item')?.focus();
    }
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'claudian-mcp-selector-header' });
    headerEl.setText('Mcp servers');

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'claudian-mcp-selector-list' });

    const allServers = this.mcpManager?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'claudian-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'No MCP servers configured' : 'All MCP servers disabled');
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'claudian-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;
    itemEl.setAttribute('role', 'checkbox');
    itemEl.setAttribute('tabindex', '0');

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.addClass('enabled');
    }
    itemEl.setAttribute('aria-checked', String(isEnabled));

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'claudian-mcp-selector-check' });
    if (isEnabled) {
      appendCheckIcon(checkEl);
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'claudian-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'claudian-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'claudian-mcp-selector-cs-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', 'Context-saving: can also enable via @' + server.name);
    }

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
    itemEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.toggleServer(server.name, itemEl);
    });
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    itemEl.setAttribute('aria-checked', String(isEnabled));
    const checkEl = itemEl.querySelector<HTMLElement>('.claudian-mcp-selector-check');

    if (isEnabled) {
      itemEl.addClass('enabled');
      if (checkEl) appendCheckIcon(checkEl);
    } else {
      itemEl.removeClass('enabled');
      if (checkEl) checkEl.empty();
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasServers = (this.mcpManager?.getServers().length || 0) > 0;

    // Show/hide container based on whether there are servers and visibility
    if (!hasServers || !this.visible) {
      this.container.addClass('claudian-hidden');
      this.container.closest('.claudian-context-action-section')?.classList?.add('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');
    this.container.closest('.claudian-context-action-section')?.classList?.remove('claudian-hidden');

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} MCP server${count > 1 ? 's' : ''} enabled (click to manage)`);

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Mcp servers (click to enable)');
      this.badgeEl.removeClass('visible');
    }
  }
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'claudian-context-meter' });
    this.container.setAttribute('role', 'progressbar');
    this.container.setAttribute('aria-label', 'Context usage');
    this.container.setAttribute('aria-valuemin', '0');
    this.container.setAttribute('aria-valuemax', '100');
    this.render();
    // Initially hidden
    this.container.addClass('claudian-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('claudian-hidden', !visible);
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'claudian-context-meter-gauge' });
    const svg = gaugeEl.createSvg('svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;
    const backgroundPath = svg.createSvg('path');
    backgroundPath.classList.add('claudian-meter-bg');
    backgroundPath.setAttribute('d', pathData);
    backgroundPath.setAttribute('fill', 'none');
    backgroundPath.setAttribute('stroke-width', String(strokeWidth));
    backgroundPath.setAttribute('stroke-linecap', 'round');

    const fillPath = svg.createSvg('path');
    fillPath.classList.add('claudian-meter-fill');
    fillPath.setAttribute('d', pathData);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke-width', String(strokeWidth));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('stroke-dasharray', String(this.circumference));
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.appendChild(backgroundPath);
    svg.appendChild(fillPath);
    gaugeEl.appendChild(svg);
    this.fillPath = fillPath;

    this.percentEl = this.container.createSpan({ cls: 'claudian-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextWindow <= 0) {
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
    }

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Approaching limit, run `/compact` to continue)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
    this.container.setAttribute('aria-valuenow', String(usage.percentage));
    this.container.setAttribute(
      'aria-valuetext',
      `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`,
    );
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

const TOOLBAR_COMPACT_CLASS = 'claudian-input-toolbar--compact';
const ROW_CENTER_TOLERANCE = 1;

let nextContextActionsMenuId = 0;

export class ContextActionsMenu {
  private container: HTMLElement | null = null;
  private onChange: (() => void) | null = null;
  private isOpen = false;
  readonly id = `claudian-context-actions-${++nextContextActionsMenuId}`;

  private readonly handleDocumentClick = (event: MouseEvent): void => {
    if (this.container && !this.container.contains(event.target as Node)) {
      this.setOpen(false);
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.setOpen(false, true);
  };

  attach(container: HTMLElement): void {
    this.container = container;
    const ownerDocument = container.ownerDocument;
    ownerDocument.addEventListener('click', this.handleDocumentClick, true);
    ownerDocument.addEventListener('keydown', this.handleDocumentKeydown, true);
  }

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  close(): void {
    this.setOpen(false);
  }

  destroy(): void {
    this.container?.ownerDocument.removeEventListener('click', this.handleDocumentClick, true);
    this.container?.ownerDocument.removeEventListener('keydown', this.handleDocumentKeydown, true);
    this.container = null;
    this.onChange = null;
    this.setOpen(false);
  }

  private setOpen(open: boolean, restoreFocus = false): void {
    this.isOpen = open;
    this.onChange?.();
    if (open) {
      this.container?.querySelector<HTMLElement>('.claudian-context-actions-menu')?.focus();
    } else if (restoreFocus) {
      this.container?.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger')?.focus();
    }
  }
}

/** Hides optional labels only when the full toolbar would wrap. */
export class InputToolbarLayoutController {
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private pendingLayout: ScheduledAnimationFrame | null = null;

  constructor(private readonly toolbarEl: HTMLElement) {
    this.observeLayoutChanges();
    this.scheduleLayout();
  }

  refreshLayout(): void {
    this.toolbarEl.classList.remove(TOOLBAR_COMPACT_CLASS);
    this.toolbarEl.classList.toggle(TOOLBAR_COMPACT_CLASS, this.hasWrappedItems());
  }

  destroy(): void {
    if (this.pendingLayout !== null) {
      cancelScheduledAnimationFrame(this.pendingLayout);
      this.pendingLayout = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  private hasWrappedItems(): boolean {
    const items = Array.from(this.toolbarEl.children).flatMap((item) => (
      item.classList.contains('claudian-input-toolbar-group')
        ? Array.from(item.children)
        : [item]
    )).flatMap((item) => (
      item.classList.contains('claudian-input-toolbar-slot')
        ? Array.from(item.children)
        : [item]
    ));
    const rowCenters = items
      .map((item) => item.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.top + rect.height / 2);
    const firstRowCenter = rowCenters[0];
    if (firstRowCenter === undefined) return false;

    return rowCenters.some((center) => Math.abs(center - firstRowCenter) > ROW_CENTER_TOLERANCE);
  }

  private scheduleLayout(): void {
    if (this.pendingLayout !== null) {
      cancelScheduledAnimationFrame(this.pendingLayout);
    }
    this.pendingLayout = scheduleAnimationFrame(() => {
      this.pendingLayout = null;
      this.refreshLayout();
    }, this.toolbarEl.ownerDocument.defaultView);
  }

  private observeLayoutChanges(): void {
    const ownerWindow = this.toolbarEl.ownerDocument.defaultView;
    const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
    if (typeof ResizeObserverConstructor === 'function') {
      this.resizeObserver = new ResizeObserverConstructor(() => this.scheduleLayout());
      this.resizeObserver.observe(this.toolbarEl);
    }

    const MutationObserverConstructor = ownerWindow?.MutationObserver;
    if (typeof MutationObserverConstructor !== 'function') return;

    this.mutationObserver = new MutationObserverConstructor((mutations) => {
      const hasContentChange = mutations.some((mutation) => (
        mutation.type !== 'attributes'
        || mutation.target !== this.toolbarEl
        || mutation.attributeName !== 'class'
      ));
      if (hasContentChange) {
        this.scheduleLayout();
      }
    });
    this.mutationObserver.observe(this.toolbarEl, {
      attributes: true,
      attributeFilter: ['class'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter | null;
  layoutController: InputToolbarLayoutController;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionModeMenuHandle;
  serviceTierToggle: ServiceTierToggle;
  contextActionsMenu: ContextActionsMenu;
  refreshLocale: () => void;
  sendButtonSlot: HTMLElement;
  destroy: () => void;
} {
  const root: PreactRoot = createPreactRoot(parentEl);
  const contextActionsMenu = new ContextActionsMenu();
  const slots = new Map<InputToolbarSlot, HTMLElement>();
  const modeMenuId = `claudian-permission-mode-menu-${++nextPermissionModeMenuId}`;
  let externalContextSelector: ExternalContextSelector | null = null;
  let permissionModeMenuVisible = true;
  let permissionModeMenuOpen = false;
  let currentModeOptions: PermissionModeMenuOption[] = [];
  let currentSelectedMode = '';
  const selectPermissionMode = (mode: string): void => runToolbarAction(async () => {
    currentSelectedMode = mode;
    try {
      await callbacks.onPermissionModeChange(mode);
    } finally {
      render();
    }
  }, 'Failed to change permission mode');

  const render = (): void => {
    const settings = callbacks.getSettings();
    const uiConfig = callbacks.getUIConfig();
    const providerModeOptions = uiConfig.getPermissionModeOptions?.(settings);
    const modeOptions: PermissionModeMenuOption[] = (providerModeOptions ?? []).filter(option => (
      !option.isPlanMode || callbacks.getCapabilities().supportsPlanMode
    ));
    const resolvedMode = uiConfig.resolvePermissionModeOption?.(settings)
      ?? uiConfig.resolvePermissionMode?.(settings)
      ?? settings.permissionMode;
    const selectedMode = modeOptions.some(option => option.value === resolvedMode)
      ? resolvedMode
      : '';
    currentModeOptions = modeOptions;
    currentSelectedMode = selectedMode;

    root.render(h(InputToolbarView, {
      addContextLabel: t('chat.composer.addContext'),
      menuId: contextActionsMenu.id,
      menuOpen: contextActionsMenu.open,
      mcpLabel: t('settings.mcpServers.name'),
      modeMenuId,
      modeMenuLabel: t('chat.composer.modes'),
      modeMenuOpen: permissionModeMenuOpen,
      modeOptions,
      selectedMode,
      modeMenuVisible: permissionModeMenuVisible && modeOptions.length > 0,
      onAddContext: () => {
        contextActionsMenu.toggle();
        callbacks.onAddContext?.();
      },
      onMenuToggle: () => contextActionsMenu.toggle(),
      onModeMenuOpenChange: (open: boolean) => {
        if (permissionModeMenuOpen === open) return;
        permissionModeMenuOpen = open;
        render();
      },
      onPermissionModeChange: selectPermissionMode,
      onSlot: (slot, element) => {
        if (element) slots.set(slot, element);
        else slots.delete(slot);
      },
    }));
    if (!contextActionsMenu.open) externalContextSelector?.closeDropdown();
  };
  render();
  contextActionsMenu.setOnChange(render);
  contextActionsMenu.attach(parentEl.querySelector('.claudian-context-actions') ?? parentEl);

  const getSlot = (name: InputToolbarSlot): HTMLElement => {
    const slot = slots.get(name);
    if (!slot) throw new Error(`Input toolbar view did not mount the ${name} slot`);
    return slot;
  };
  externalContextSelector = new ExternalContextSelector(
    getSlot('context-external'),
    {
      ...callbacks,
      onCloseContextActionsMenu: () => contextActionsMenu.close(),
    },
  );
  const mcpServerSelector = new McpServerSelector(getSlot('context-mcp'));
  const modelSelector = new ModelSelector(getSlot('model'), callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(
    getSlot('model'),
    callbacks,
    modelSelector,
  );
  const serviceTierToggle = new ServiceTierToggle(
    getSlot('model'),
    callbacks,
    modelSelector,
  );
  const contextUsageMeter = new ContextUsageMeter(getSlot('status'));
  const permissionToggle: PermissionModeMenuHandle = {
    updateDisplay: render,
    canCycle: () => currentModeOptions.length > 1,
    cycleMode: (onSelect) => {
      if (currentModeOptions.length < 2) return false;
      const currentIndex = currentModeOptions.findIndex(
        option => option.value === currentSelectedMode,
      );
      const nextIndex = currentIndex < 0 || currentIndex === currentModeOptions.length - 1
        ? 0
        : currentIndex + 1;
      const nextMode = currentModeOptions[nextIndex].value;
      currentSelectedMode = nextMode;
      (onSelect ?? selectPermissionMode)(nextMode);
      return true;
    },
    setVisible: (visible) => {
      permissionModeMenuVisible = visible;
      if (!visible) permissionModeMenuOpen = false;
      render();
    },
  };
  const modeSelector = new ModeSelector(getSlot('provider-mode'), callbacks);
  const layoutController = new InputToolbarLayoutController(parentEl);
  const refreshLocale = (): void => {
    render();
    modelSelector.updateDisplay();
    externalContextSelector?.refreshLocale();
  };

  const destroy = (): void => {
    contextActionsMenu.destroy();
    externalContextSelector?.closeDropdown();
    externalContextSelector?.destroy();
    mcpServerSelector.destroy();
    layoutController.destroy();
    thinkingBudgetSelector.destroy();
    modelSelector.destroy();
    root.unmount();
  };

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    serviceTierToggle,
    contextUsageMeter,
    layoutController,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
    contextActionsMenu,
    refreshLocale,
    sendButtonSlot: getSlot('send'),
    destroy,
  };
}
