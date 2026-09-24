/** @jest-environment jsdom */

import { setIcon } from 'obsidian';

import type { ComposerContextTray } from '@/features/chat/ui/ComposerContextTray';
import { ComposerContextTray as ComposerContextTrayImpl } from '@/features/chat/ui/ComposerContextTray';
import {
  createInputToolbar,
  type ToolbarCallbacks,
} from '@/features/chat/ui/InputToolbar';

jest.mock('obsidian', () => ({
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
    getSettings: () => ({
      model: 'claude-sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    }),
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
        activeValue: 'yolo',
        activeLabel: 'YOLO',
      }),
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
    toolbarEl = document.createElement('div');
    document.body.append(toolbarEl);
    callbacks = createCallbacks();
    toolbar = createInputToolbar(toolbarEl, callbacks);
  });

  afterEach(() => {
    toolbar?.destroy();
    toolbarEl.remove();
  });

  it('groups external context controls behind an accessible add-context action', () => {
    const trigger = toolbarEl.querySelector<HTMLButtonElement>('.claudian-context-actions-trigger');
    const menu = toolbarEl.querySelector<HTMLElement>('.claudian-context-actions-menu');
    const configurationGroup = toolbarEl.querySelector('.claudian-input-toolbar-config-group');
    const executionGroup = toolbarEl.querySelector('.claudian-input-toolbar-execution-group');

    expect(trigger?.getAttribute('aria-label')).toBe('Add context');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.hidden).toBe(true);
    expect(menu?.querySelector('.claudian-external-context-selector')).not.toBeNull();
    expect(menu?.querySelector('.claudian-mcp-selector')).not.toBeNull();
    expect(configurationGroup?.querySelector('.claudian-model-selector')).not.toBeNull();
    expect(configurationGroup?.querySelector('.claudian-thinking-selector')).not.toBeNull();
    expect(executionGroup?.querySelector('.claudian-permission-toggle')).not.toBeNull();
    expect(executionGroup?.querySelector('.claudian-mode-selector')).not.toBeNull();
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'plus');
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
