/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: (element: HTMLElement, icon: string) => {
    element.dataset.icon = icon;
  },
}));

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirmDelete: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/shared/settings/McpImportModal', () => ({
  McpImportModal: class {
    open(): void {}
  },
}));

jest.mock('@/shared/settings/McpServerModal', () => ({
  McpServerModal: class {
    open(): void {}
  },
}));

jest.mock('@/shared/settings/McpTestModal', () => ({
  McpTestModal: class {
    open(): void {}
  },
}));

import type { ManagedMcpServer } from '@/core/types';
import {
  destroyMcpSettingsManagers,
  McpSettingsManager,
} from '@/shared/settings/McpSettingsManager';

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('McpSettingsManager settings view', () => {
  it('opens the add menu and closes it with Escape', async () => {
    const container = document.createElement('div');
    new McpSettingsManager(container, {
      app: {} as never,
      mcpStorage: {
        load: async () => [],
        save: async () => {},
      },
      broadcastMcpReload: async () => {},
    });
    await tick();

    const addButton = container.querySelector<HTMLButtonElement>('.claudian-settings-action-btn');
    expect(addButton?.getAttribute('aria-expanded')).toBe('false');
    addButton?.click();
    expect(addButton?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.claudian-mcp-add-dropdown')?.classList.contains('is-visible'))
      .toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(addButton?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.claudian-mcp-add-dropdown')?.classList.contains('is-visible'))
      .toBe(false);

    destroyMcpSettingsManagers(container);
    expect(container.childElementCount).toBe(0);
  });

  it('persists a server enable toggle from the rendered settings list', async () => {
    const server: ManagedMcpServer = {
      name: 'alpha',
      config: { command: 'alpha', args: [] },
      enabled: true,
      contextSaving: false,
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const container = document.createElement('div');
    new McpSettingsManager(container, {
      app: {} as never,
      mcpStorage: {
        load: async () => [server],
        save,
      },
      broadcastMcpReload: async () => {},
    });
    await tick();

    expect(container.querySelector('.claudian-mcp-name')?.textContent).toBe('alpha');
    container.querySelector<HTMLButtonElement>('[aria-label="Disable"]')?.click();
    await tick();

    expect(server.enabled).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Enable"]')).not.toBeNull();
    destroyMcpSettingsManagers(container);
  });
});
