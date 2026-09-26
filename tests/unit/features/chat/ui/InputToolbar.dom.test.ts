/** @jest-environment jsdom */

import { setIcon } from 'obsidian';

import type { ComposerContextTray } from '@/features/chat/ui/ComposerContextTray';
import { ComposerContextTray as ComposerContextTrayImpl } from '@/features/chat/ui/ComposerContextTray';
import {
  createInputToolbar,
  type ToolbarCallbacks,
} from '@/features/chat/ui/InputToolbar';
import { setLocale } from '@/i18n/i18n';
import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';
import { cursorChatUIConfig } from '@/providers/cursor/ui/CursorChatUIConfig';
import { grokChatUIConfig } from '@/providers/grok/ui/GrokChatUIConfig';
import { ompChatUIConfig } from '@/providers/omp/ui/OmpChatUIConfig';
import { opencodeChatUIConfig } from '@/providers/opencode/ui/OpencodeChatUIConfig';
import { piChatUIConfig } from '@/providers/pi/ui/PiChatUIConfig';

jest.mock('obsidian', () => ({
  Modal: class {},
  Notice: jest.fn(),
  setIcon: jest.fn(),
}));

jest.mock('electron', () => ({
  remote: {
    dialog: {
      showOpenDialog: jest.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    },
  },
}), { virtual: true });

jest.mock('fs');

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};

HTMLElement.prototype.setText = function setText(text: string): void {
  this.textContent = text;
};

function createCallbacks(): ToolbarCallbacks {
  const settings = {
    model: 'claude-sonnet',
    thinkingBudget: 'low',
    effortLevel: 'high',
    serviceTier: 'default',
    permissionMode: 'normal',
  };

  return {
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn().mockResolvedValue(undefined),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
    onAddContext: jest.fn(),
    onExternalFilesSelected: jest.fn(),
    onContextPathActivate: jest.fn(),
    getSettings: () => settings,
    getUIConfig: () => ({
      getProviderIcon: () => null,
      getModelOptions: () => [{ value: 'claude-sonnet', label: 'Sonnet' }],
      getReasoningOptions: () => [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
      getDefaultReasoningValue: () => 'low',
      isAdaptiveReasoningModel: () => true,
      getModeSelector: () => ({
        activeValue: 'build',
        label: 'Mode',
        options: [
          { value: 'build', label: 'Build' },
          { value: 'plan', label: 'Plan' },
        ],
        value: 'build',
      }),
      getPermissionModeToggle: () => ({
        inactiveValue: 'normal',
        inactiveLabel: 'Safe',
        inactiveDescription: 'Use the configured sandbox and request approval when needed.',
        inactiveIcon: 'shield-check',
        activeValue: 'yolo',
        activeLabel: 'YOLO',
        activeDescription: 'Run with full workspace access and no approval prompts.',
        activeIcon: 'zap',
        activeIsDangerous: true,
        planValue: 'plan',
        planLabel: 'Plan',
        planDescription: 'Explore and prepare a plan before editing.',
        planIcon: 'clipboard-list',
      }),
      getPermissionModeOptions: () => ([
        {
          value: 'normal',
          label: 'Safe',
          description: 'Use the configured sandbox and request approval when needed.',
          icon: 'shield-check',
        },
        {
          value: 'yolo',
          label: 'YOLO',
          description: 'Run with full workspace access and no approval prompts.',
          icon: 'zap',
          isDangerous: true,
        },
        {
          value: 'plan',
          label: 'Plan',
          description: 'Explore and prepare a plan before editing.',
          icon: 'clipboard-list',
          isPlanMode: true,
        },
      ]),
      getServiceTierToggle: () => null,
    }) as unknown as ReturnType<ToolbarCallbacks['getUIConfig']>,
    getCapabilities: () => ({
      providerId: 'claude',
      reasoningControl: 'effort',
      supportsPlanMode: true,
    }) as ReturnType<ToolbarCallbacks['getCapabilities']>,
  };
}

describe('createInputToolbar', () => {
  let toolbarEl: HTMLDivElement;
  let callbacks: ToolbarCallbacks;
  let toolbar: ReturnType<typeof createInputToolbar> | undefined;

  beforeEach(() => {
    setLocale('en');
    toolbarEl = document.createElement('div');
    document.body.append(toolbarEl);
    callbacks = createCallbacks();
    toolbar = createInputToolbar(toolbarEl, callbacks);
  });

  afterEach(() => {
    toolbar?.destroy();
    toolbarEl.remove();
    setLocale('en');
  });

  it('groups external context controls behind an accessible add-context action', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger');
    const menu = toolbarEl.querySelector<HTMLElement>('.claudian-context-actions-menu');
    const configurationGroup = toolbarEl.querySelector('.claudian-input-toolbar-config-group');
    const executionGroup = toolbarEl.querySelector('.claudian-input-toolbar-execution-group');
    const modeMenu = toolbarEl.querySelector('.claudian-permission-mode-menu');

    expect(trigger?.getAttribute('aria-label')).toBe('Add context');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.hidden).toBe(true);
    expect(menu?.querySelector('.claudian-external-context-selector')).not.toBeNull();
    expect(menu?.querySelector('.claudian-mcp-selector')).not.toBeNull();
    expect(configurationGroup?.querySelector('.claudian-model-selector')).not.toBeNull();
    expect(configurationGroup?.querySelector('.claudian-thinking-selector')).not.toBeNull();
    expect(modeMenu?.querySelector('.claudian-thinking-selector')).toBeNull();
    expect(executionGroup?.querySelector('.claudian-permission-mode-menu')).not.toBeNull();
    expect(executionGroup?.querySelector('.claudian-mode-selector')).not.toBeNull();
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'plus');
  });

  it('opens a Preact mode menu with the selected provider mode marked', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-trigger',
    );
    const popover = toolbarEl.querySelector<HTMLElement>(
      '.claudian-permission-mode-popover',
    );

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-controls')).toBe(popover?.id);
    expect(popover?.hidden).toBe(true);

    trigger?.click();

    const updatedTrigger = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-trigger',
    );
    const updatedPopover = toolbarEl.querySelector<HTMLElement>(
      '.claudian-permission-mode-popover',
    );
    expect(updatedTrigger?.getAttribute('aria-expanded')).toBe('true');
    expect(updatedPopover?.hidden).toBe(false);
    expect(Array.from(updatedPopover?.querySelectorAll<HTMLButtonElement>(
      '.claudian-permission-mode-option',
    ) ?? []).map(option => ({
      label: option.querySelector('.claudian-permission-mode-option-label')?.textContent,
      description: option.querySelector('.claudian-permission-mode-option-description')?.textContent,
    }))).toEqual([
      {
        label: 'Safe',
        description: 'Use the configured sandbox and request approval when needed.',
      },
      {
        label: 'YOLO',
        description: 'Run with full workspace access and no approval prompts.',
      },
      {
        label: 'Plan',
        description: 'Explore and prepare a plan before editing.',
      },
    ]);
    expect(updatedPopover?.querySelector('[data-mode-value="normal"]')?.getAttribute('aria-checked'))
      .toBe('true');
  });

  it('does not infer mode options from the legacy toggle descriptor', () => {
    const baseUIConfig = callbacks.getUIConfig();
    callbacks.getUIConfig = () => ({
      ...baseUIConfig,
      getPermissionModeOptions: undefined,
    }) as ReturnType<ToolbarCallbacks['getUIConfig']>;
    toolbar?.permissionToggle.updateDisplay();

    expect(toolbarEl.querySelector('.claudian-permission-mode-menu')?.classList)
      .toContain('claudian-hidden');
    expect(toolbarEl.querySelector('.claudian-permission-mode-option')).toBeNull();
  });

  it('shows the Shift+Tab hint and the selected mode icon in the toolbar trigger', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-trigger',
    );
    const triggerIcon = trigger?.querySelector('.claudian-permission-mode-trigger-icon');
    const hint = toolbarEl.querySelector<HTMLElement>('.claudian-permission-mode-hint');

    expect(triggerIcon).not.toBeNull();
    expect(setIcon).toHaveBeenCalledWith(triggerIcon, 'shield-check');
    expect(hint?.getAttribute('aria-label')).toBe('Shift + Tab to switch');
    expect(hint?.querySelectorAll('kbd')).toHaveLength(2);
  });

  it.each([
    ['en', 'Shift + Tab to switch', 'to switch'],
    ['zh-CN', 'Shift + Tab 切换模式', '切换模式'],
    ['zh-TW', 'Shift + Tab 切換模式', '切換模式'],
    ['de', 'Umschalt + Tab zum Wechseln', 'zum Wechseln'],
    ['es', 'Mayús + Tab para cambiar', 'para cambiar'],
    ['fr', 'Maj + Tab pour changer', 'pour changer'],
    ['ja', 'Shift + Tab 切り替え', '切り替え'],
    ['ko', 'Shift + Tab 전환', '전환'],
    ['pt', 'Shift + Tab para alternar', 'para alternar'],
    ['ru', 'Shift + Tab для переключения', 'для переключения'],
  ] as const)('localizes the mode-switch hint in %s', (locale, expectedLabel, expectedCopy) => {
    setLocale(locale);
    toolbar?.refreshLocale();

    const hint = toolbarEl.querySelector<HTMLElement>('.claudian-permission-mode-hint');
    expect(hint?.getAttribute('aria-label')).toBe(expectedLabel);
    expect(hint?.querySelector('.claudian-permission-mode-hint-copy')?.textContent)
      .toBe(expectedCopy);
  });

  it('cycles through all provider modes in menu order and wraps around', async () => {
    callbacks.getUIConfig = () => claudeChatUIConfig;
    const settings = callbacks.getSettings();
    claudeChatUIConfig.applyPermissionMode?.('claude-manual', settings);
    callbacks.onPermissionModeChange = jest.fn(async (mode: string) => {
      claudeChatUIConfig.applyPermissionMode?.(mode, settings);
    });
    toolbar?.permissionToggle.updateDisplay();

    expect(toolbar?.permissionToggle.canCycle?.()).toBe(true);
    expect(toolbar?.permissionToggle.cycleMode?.()).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callbacks.onPermissionModeChange).toHaveBeenNthCalledWith(1, 'claude-edit');
    expect(setIcon).toHaveBeenCalledWith(
      toolbarEl.querySelector('.claudian-permission-mode-trigger-icon'),
      'code',
    );

    expect(toolbar?.permissionToggle.cycleMode?.()).toBe(true);
    expect(toolbar?.permissionToggle.cycleMode?.()).toBe(true);
    expect(toolbar?.permissionToggle.cycleMode?.()).toBe(true);
    expect(callbacks.onPermissionModeChange).toHaveBeenNthCalledWith(2, 'plan');
    expect(callbacks.onPermissionModeChange).toHaveBeenNthCalledWith(3, 'claude-auto');
    expect(callbacks.onPermissionModeChange).toHaveBeenNthCalledWith(4, 'claude-manual');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setIcon).toHaveBeenCalledWith(
      toolbarEl.querySelector('.claudian-permission-mode-trigger-icon'),
      'hand',
    );
  });

  it('routes a mode cycle through the caller-provided mode handler', () => {
    callbacks.getUIConfig = () => claudeChatUIConfig;
    const settings = callbacks.getSettings();
    claudeChatUIConfig.applyPermissionMode?.('claude-manual', settings);
    toolbar?.permissionToggle.updateDisplay();
    const onSelect = jest.fn();

    expect(toolbar?.permissionToggle.cycleMode?.(onSelect)).toBe(true);

    expect(onSelect).toHaveBeenCalledWith('claude-edit');
    expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();
  });

  it('renders provider-owned mode descriptions and keeps provider selections distinct', () => {
    callbacks.getCapabilities = () => ({
      providerId: 'claude',
      reasoningControl: 'effort',
      supportsPlanMode: false,
    }) as ReturnType<ToolbarCallbacks['getCapabilities']>;
    const baseUIConfig = callbacks.getUIConfig();
    callbacks.getUIConfig = () => ({
      ...baseUIConfig,
      getPermissionModeOptions: () => [
        {
          value: 'manual',
          label: 'Manual',
          description: 'Ask before making changes.',
          icon: 'hand',
        },
        {
          value: 'plan',
          label: 'Plan',
          description: 'Explore and present a plan before editing.',
          icon: 'clipboard-list',
          isPlanMode: true,
        },
      ],
      resolvePermissionModeOption: () => 'manual',
    }) as ReturnType<ToolbarCallbacks['getUIConfig']>;
    toolbar?.permissionToggle.updateDisplay();

    toolbarEl.querySelector<HTMLButtonElement>('.claudian-permission-mode-trigger')?.click();

    const manualOption = toolbarEl.querySelector<HTMLElement>(
      '.claudian-permission-mode-option[data-mode-value="manual"]',
    );
    expect(manualOption?.querySelector('.claudian-permission-mode-option-label')?.textContent)
      .toBe('Manual');
    expect(manualOption?.querySelector('.claudian-permission-mode-option-description')?.textContent)
      .toBe('Ask before making changes.');
    expect(manualOption?.querySelector('.claudian-permission-mode-option-icon'))
      .not.toBeNull();
    expect(manualOption?.getAttribute('aria-checked')).toBe('true');
    expect(toolbarEl.querySelector('[data-mode-value="plan"]')).toBeNull();
  });

  it('refreshes mounted Claude mode labels when the locale changes', () => {
    callbacks.getUIConfig = () => claudeChatUIConfig;
    toolbar?.permissionToggle.updateDisplay();

    setLocale('zh-CN');
    toolbar?.refreshLocale();
    toolbarEl.querySelector<HTMLButtonElement>('.claudian-permission-mode-trigger')?.click();
    expect(toolbarEl.querySelector(
      '.claudian-permission-mode-option[data-mode-value="claude-edit"] .claudian-permission-mode-option-label',
    )?.textContent).toBe('接受编辑');

    setLocale('en');
    toolbar?.refreshLocale();
    expect(toolbarEl.querySelector(
      '.claudian-permission-mode-option[data-mode-value="claude-edit"] .claudian-permission-mode-option-label',
    )?.textContent).toBe('Accept edits');
  });

  it('renders only Claude’s four native modes and leaves legacy YOLO unselected', () => {
    callbacks.getUIConfig = () => claudeChatUIConfig;
    callbacks.getSettings().permissionMode = 'yolo';
    toolbar?.permissionToggle.updateDisplay();
    toolbarEl.querySelector<HTMLButtonElement>('.claudian-permission-mode-trigger')?.click();

    const options = Array.from(toolbarEl.querySelectorAll<HTMLButtonElement>(
      '.claudian-permission-mode-option',
    ));
    expect(options.map(option => option.querySelector(
      '.claudian-permission-mode-option-label',
    )?.textContent)).toEqual(['Manual', 'Accept edits', 'Plan', 'Auto']);
    expect(options.filter(option => option.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(toolbarEl.querySelector(
      '.claudian-permission-mode-trigger span',
    )?.textContent).toBe('Modes');
  });

  it.each([
    ['Claude', 'claude', claudeChatUIConfig, ['Manual', 'Accept edits', 'Plan', 'Auto'], []],
    ['Codex', 'codex', codexChatUIConfig, ['Workspace write', 'Full access', 'Plan'], ['Full access']],
    ['Cursor', 'cursor', cursorChatUIConfig, ['Agent', 'Ask', 'Plan'], []],
    ['Grok', 'grok', grokChatUIConfig, ['Ask', 'Plan', 'Always approve'], ['Always approve']],
    ['OMP', 'omp', ompChatUIConfig, ['Always ask', 'Write', 'YOLO'], ['YOLO']],
    ['OpenCode', 'opencode', opencodeChatUIConfig, ['Build', 'Plan'], []],
    ['Pi', 'pi', piChatUIConfig, ['Read only', 'All tools'], ['All tools']],
  ])('uses the shared detailed mode cards for %s', (
    _name,
    providerId,
    uiConfig,
    expectedLabels,
    expectedDangerousLabels,
  ) => {
    callbacks.getUIConfig = () => uiConfig;
    if (providerId === 'opencode') {
      callbacks.getSettings().providerConfigs = {
        opencode: {
          availableModes: [
            { id: 'build', name: 'Build', description: 'Build with configured tools.' },
            { id: 'plan', name: 'Plan', description: 'Plan before changes.' },
          ],
          selectedMode: 'build',
        },
      };
    }
    callbacks.getCapabilities = () => ({
      providerId,
      reasoningControl: 'effort',
      supportsPlanMode: true,
    }) as ReturnType<ToolbarCallbacks['getCapabilities']>;
    toolbar?.permissionToggle.updateDisplay();
    toolbarEl.querySelector<HTMLButtonElement>('.claudian-permission-mode-trigger')?.click();

    const options = Array.from(toolbarEl.querySelectorAll<HTMLButtonElement>(
      '.claudian-permission-mode-option',
    ));
    expect(options.map(option => option.querySelector(
      '.claudian-permission-mode-option-label',
    )?.textContent)).toEqual(expectedLabels);
    expect(options.every(option => (
      option.querySelector('.claudian-permission-mode-option-icon')
      && option.querySelector('.claudian-permission-mode-option-description')?.textContent?.trim()
    ))).toBe(true);
    expect(options.filter(option => option.classList.contains('is-dangerous')).map(option => (
      option.querySelector('.claudian-permission-mode-option-label')?.textContent
    ))).toEqual(expectedDangerousLabels);
  });

  it('refreshes provider mode descriptions when the interface locale changes', () => {
    callbacks.getUIConfig = () => cursorChatUIConfig;
    toolbar?.permissionToggle.updateDisplay();

    setLocale('zh-CN');
    toolbar?.refreshLocale();
    toolbarEl.querySelector<HTMLButtonElement>('.claudian-permission-mode-trigger')?.click();
    expect(toolbarEl.querySelector(
      '.claudian-permission-mode-option[data-mode-value="normal"] .claudian-permission-mode-option-description',
    )?.textContent).toBe('使用 Cursor Agent 工具探索并修改工作区。');

    setLocale('en');
    toolbar?.refreshLocale();
    expect(toolbarEl.querySelector(
      '.claudian-permission-mode-option[data-mode-value="normal"] .claudian-permission-mode-option-description',
    )?.textContent).toBe('Let Cursor Agent use its tools to work on your request.');
  });

  it('uses the provider mode labels, hides unsupported Plan and applies selection', async () => {
    callbacks.getCapabilities = () => ({
      providerId: 'omp',
      reasoningControl: 'effort',
      supportsPlanMode: false,
    }) as ReturnType<ToolbarCallbacks['getCapabilities']>;
    const baseUIConfig = callbacks.getUIConfig();
    callbacks.getUIConfig = () => ({
      ...baseUIConfig,
      getPermissionModeToggle: () => ({
        inactiveValue: 'normal',
        inactiveLabel: 'Manual',
        activeValue: 'yolo',
        activeLabel: 'Auto',
        planValue: 'plan',
        planLabel: 'Plan',
      }),
      getPermissionModeOptions: () => ([
        { value: 'normal', label: 'Manual', description: 'Ask before editing.', icon: 'hand' },
        { value: 'yolo', label: 'Auto', description: 'Run automatically.', icon: 'zap' },
        {
          value: 'plan',
          label: 'Plan',
          description: 'Prepare a plan.',
          icon: 'clipboard-list',
          isPlanMode: true,
        },
      ]),
    }) as ReturnType<ToolbarCallbacks['getUIConfig']>;
    callbacks.onPermissionModeChange = jest.fn(async (mode: string) => {
      callbacks.getSettings().permissionMode = mode;
    });
    toolbar?.permissionToggle.updateDisplay();

    toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-trigger',
    )?.click();
    expect(toolbarEl.querySelector('[data-mode-value="plan"]')).toBeNull();
    expect(Array.from(toolbarEl.querySelectorAll('.claudian-permission-mode-option'))
      .map(option => option.querySelector('.claudian-permission-mode-option-label')?.textContent))
      .toEqual(['Manual', 'Auto']);

    toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-option[data-mode-value="yolo"]',
    )?.click();
    await Promise.resolve();

    expect(callbacks.onPermissionModeChange).toHaveBeenCalledWith('yolo');
    expect(toolbarEl.querySelector('.claudian-permission-mode-trigger')?.textContent)
      .toContain('Auto');
    expect(toolbarEl.querySelector('.claudian-permission-mode-popover')?.hasAttribute('hidden'))
      .toBe(true);
  });

  it('supports keyboard navigation and closes on Escape with focus restored', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-trigger',
    );
    trigger?.click();

    const options = toolbarEl.querySelectorAll<HTMLButtonElement>(
      '.claudian-permission-mode-option',
    );
    expect(document.activeElement).toBe(options[0]);

    options[0]?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'ArrowDown',
    }));
    expect(document.activeElement).toBe(options[1]);

    options[1]?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Escape',
    }));
    expect(toolbarEl.querySelector('.claudian-permission-mode-popover')?.hasAttribute('hidden'))
      .toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the reasoning option list on Escape without opening permission modes', () => {
    const reasoningTrigger = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-thinking-current',
    );
    const permissionMenu = toolbarEl.querySelector<HTMLElement>(
      '.claudian-permission-mode-popover',
    );
    reasoningTrigger?.click();
    expect(toolbarEl.querySelector('.claudian-thinking-gears.is-open')).not.toBeNull();

    reasoningTrigger?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Escape',
    }));

    expect(toolbarEl.querySelector('.claudian-thinking-gears.is-open')).toBeNull();
    expect(permissionMenu?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the provider reasoning selector in the toolbar configuration group', () => {
    const popover = toolbarEl.querySelector('.claudian-permission-mode-popover');
    const reasoningSelector = toolbarEl.querySelector('.claudian-thinking-selector');
    const configurationGroup = toolbarEl.querySelector('.claudian-input-toolbar-config-group');

    expect(configurationGroup?.contains(reasoningSelector)).toBe(true);
    expect(popover?.contains(reasoningSelector)).toBe(false);
    expect(popover?.querySelector('.claudian-permission-mode-reasoning')).toBeNull();

    reasoningSelector?.querySelector<HTMLButtonElement>(
      '.claudian-thinking-current',
    )?.click();
    Array.from(reasoningSelector?.querySelectorAll<HTMLElement>(
      '.claudian-thinking-gear',
    ) ?? []).find(option => option.textContent === 'Low')?.click();

    expect(callbacks.onEffortLevelChange).toHaveBeenCalledWith('low');
  });

  it('unmounts the mode menu with the toolbar root', () => {
    toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-trigger',
    )?.click();
    toolbar?.destroy();
    toolbar = undefined;

    expect(toolbarEl.querySelector('.claudian-permission-mode-menu')).toBeNull();
    expect(toolbarEl.querySelector('.claudian-context-actions')).toBeNull();
  });

  it('refreshes mounted composer labels when the locale owner requests it', () => {
    const addContext = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-context-actions-trigger',
    );
    const externalPicker = toolbarEl.querySelector<HTMLButtonElement>(
      '.claudian-external-context-picker',
    );

    expect(addContext?.getAttribute('aria-label')).toBe('Add context');
    expect(externalPicker?.getAttribute('aria-label')).toBe('Add files or folders');

    setLocale('zh-CN');
    toolbar?.refreshLocale();

    expect(toolbarEl.querySelector('.claudian-context-actions-trigger')?.getAttribute('aria-label'))
      .toBe('添加上下文');
    expect(toolbarEl.querySelector('.claudian-external-context-picker')?.getAttribute('aria-label'))
      .toBe('添加文件或文件夹');
    expect(toolbarEl.querySelector('.claudian-external-context-label')?.textContent)
      .toBe('添加文件或文件夹');
  });

  it('activates an external folder chip through the context-path callback', () => {
    const trayEl = document.createElement('div');
    toolbarEl.append(trayEl);
    const tray = new ComposerContextTrayImpl(trayEl);
    toolbar?.externalContextSelector.setContextTray(tray);
    toolbar?.externalContextSelector.setExternalContexts(['/outside/project']);

    trayEl.querySelector<HTMLButtonElement>('.claudian-context-chip-main')?.click();

    expect(callbacks.onContextPathActivate).toHaveBeenCalledWith('/outside/project');
    tray.destroy();
  });

  it('uses the same full-width action style and leading icon layout for both context actions', () => {
    const addContext = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-action-add-context');
    const externalFolder = toolbarEl.querySelector<HTMLButtonElement>('.claudian-external-context-picker');

    expect(addContext?.classList.contains('claudian-context-action-button')).toBe(true);
    expect(externalFolder?.classList.contains('claudian-context-action-button')).toBe(true);
    expect(addContext?.querySelector('.claudian-obsidian-icon')).not.toBeNull();
    expect(externalFolder?.querySelector('.claudian-obsidian-icon')).not.toBeNull();
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'file-plus');
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'folder-plus');
  });

  it('uses Obsidian icons for external-folder management actions', () => {
    const fs = jest.requireMock('fs') as { statSync: jest.Mock };
    fs.statSync.mockReturnValue({ isDirectory: () => true });
    toolbar?.externalContextSelector.setExternalContexts(['/outside/project']);
    toolbar?.externalContextSelector.setPersistentPaths(['/outside/project']);
    toolbarEl.querySelector<HTMLButtonElement>('.claudian-external-context-manage-button')?.click();

    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'list');
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'folder');
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'lock');
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'x');
  });

  it('makes the full external-folder row activate the folder picker', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger');
    const menu = toolbarEl.querySelector<HTMLElement>('.claudian-context-actions-menu');
    const folderButton = toolbarEl.querySelector<HTMLButtonElement>('.claudian-external-context-picker');
    const label = folderButton?.querySelector('.claudian-external-context-label');
    const electron = jest.requireMock('electron') as {
      remote: { dialog: { showOpenDialog: jest.Mock } };
    };

    expect(label?.textContent).toBe('Add files or folders');
    trigger?.click();
    label?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(electron.remote.dialog.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      title: 'Select files or folders',
    });
    expect(folderButton?.classList.contains('claudian-context-action-button')).toBe(true);
    expect(folderButton?.getAttribute('aria-label')).toBe('Add files or folders');
    expect(menu?.hidden).toBe(true);
    expect(folderButton?.closest('.claudian-external-context-selector')?.classList.contains('is-open')).toBe(false);
  });

  it('routes selected files to attachment context without adding their parent as a workspace root', async () => {
    const electron = jest.requireMock('electron') as {
      remote: { dialog: { showOpenDialog: jest.Mock } };
    };
    const fs = jest.requireMock('fs') as { statSync: jest.Mock };
    electron.remote.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/outside/notes/brief.md'],
    });
    fs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });

    toolbarEl.querySelector<HTMLButtonElement>('.claudian-external-context-picker')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(callbacks.onExternalFilesSelected).toHaveBeenCalledWith(['/outside/notes/brief.md']);
    expect(toolbar?.externalContextSelector.getExternalContexts()).toEqual([]);
  });

  it('renders selected external folders as removable folder chips in the shared context tray', () => {
    const setItems = jest.fn();
    const clearItems = jest.fn();
    const contextTray = { setItems, clearItems } as unknown as ComposerContextTray;
    if (!toolbar) throw new Error('Expected the input toolbar');

    toolbar.externalContextSelector.setContextTray(contextTray);
    toolbar.externalContextSelector.setExternalContexts(['/Users/lee/project/wiki']);

    const folderItems = setItems.mock.calls.at(-1)?.[1];
    expect(setItems).toHaveBeenLastCalledWith(
      'external-contexts',
      [expect.objectContaining({
        id: '/Users/lee/project/wiki',
        kind: 'folder',
        label: 'wiki',
        icon: 'folder',
        title: '/Users/lee/project/wiki',
        removeLabel: 'Remove external folder',
      })],
    );

    folderItems[0].onRemove();

    expect(toolbar.externalContextSelector.getExternalContexts()).toEqual([]);
    expect(setItems).toHaveBeenLastCalledWith('external-contexts', []);
  });

  it('offers an Add context action that closes the menu and delegates note selection', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger');
    const menu = toolbarEl.querySelector<HTMLElement>('.claudian-context-actions-menu');
    const addContextButton = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-action-add-context');
    if (!trigger || !menu || !addContextButton) throw new Error('Expected context action controls');

    trigger.click();
    addContextButton.click();

    expect(callbacks.onAddContext).toHaveBeenCalledTimes(1);
    expect(menu.hidden).toBe(true);
  });

  it('opens the context actions and closes them with Escape, restoring focus', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger');
    const menu = toolbarEl.querySelector<HTMLElement>('.claudian-context-actions-menu');
    if (!trigger || !menu) throw new Error('Expected the context action controls');
    const sendButton = document.createElement('button');
    sendButton.className = 'claudian-input-send-button';
    toolbar?.sendButtonSlot.append(sendButton);

    trigger.click();
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(toolbarEl.querySelector('.claudian-external-context-selector')).not.toBeNull();
    expect(toolbarEl.querySelector('.claudian-mcp-selector')).not.toBeNull();
    expect(toolbarEl.querySelector('.claudian-input-send-button')).toBe(sendButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the context actions after an outside click', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger');
    const menu = toolbarEl.querySelector<HTMLElement>('.claudian-context-actions-menu');
    if (!trigger || !menu) throw new Error('Expected the context action controls');

    trigger.click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('unmounts the Preact toolbar through its public destroy method', () => {
    if (!toolbar) throw new Error('Expected the input toolbar');
    toolbar.destroy();
    toolbar = undefined;

    expect(toolbarEl.childElementCount).toBe(0);
  });

  it('preserves MCP server toggling through the context actions menu', () => {
    if (!toolbar) throw new Error('Expected the input toolbar');
    const onChange = jest.fn();
    const manager = {
      isLoaded: () => true,
      getServers: () => [{
        name: 'docs',
        enabled: true,
        contextSaving: false,
        config: { type: 'stdio', command: 'docs-server' },
      }],
    };
    toolbar.mcpServerSelector.setMcpManager(manager as never);
    toolbar.mcpServerSelector.setOnChange(onChange);

    toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger')?.click();
    toolbarEl.querySelector<HTMLButtonElement>('.claudian-mcp-selector-icon-wrapper')?.click();
    const item = toolbarEl.querySelector<HTMLElement>('.claudian-mcp-selector-item');
    if (!item) throw new Error('Expected the configured MCP server');
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(toolbar.mcpServerSelector.getEnabledServers()).toEqual(new Set(['docs']));
    expect(onChange).toHaveBeenCalledWith(new Set(['docs']));
  });
});
