import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import { h } from 'preact';

import { tryParseClipboardConfig } from '../../core/mcp/McpConfigParser';
import type { AppMcpStorage } from '../../core/providers/types';
import { isNotifiedMutationError } from '../../core/storage/NotifiedMutationError';
import type { ManagedMcpServer, McpServerConfig, McpServerType } from '../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../core/types';
import { formatCommand } from '../../utils/mcp';
import { confirmDelete } from '../modals/ConfirmModal';
import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { McpImportModal } from './McpImportModal';
import { McpServerModal } from './McpServerModal';
import type { McpSettingsViewServer } from './McpSettingsView';
import { McpSettingsView } from './McpSettingsView';
import { McpTestModal } from './McpTestModal';

export interface McpSettingsManagerDeps {
  app: App;
  mcpStorage: AppMcpStorage;
  broadcastMcpReload: () => Promise<void>;
}

let nextMenuId = 0;
const managerDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount MCP settings views before the owning provider tab is cleared. */
export function destroyMcpSettingsManagers(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-mcp-settings-mount'),
  );
  if (container.classList.contains('claudian-mcp-settings-mount')) {
    mounts.unshift(container);
  }
  mounts.forEach(mount => managerDestructors.get(mount)?.());
}

export class McpSettingsManager {
  private app: App;
  private mountEl: HTMLElement;
  private root: PreactRoot;
  private mcpStorage: AppMcpStorage;
  private broadcastMcpReload: () => Promise<void>;
  private servers: ManagedMcpServer[] = [];
  private menuOpen = false;
  private destroyed = false;
  private readonly menuId = `claudian-mcp-add-menu-${++nextMenuId}`;
  private readonly settingsDocument: Document;
  private readonly handleDocumentClick: (event: MouseEvent) => void;
  private readonly handleDocumentKeydown: (event: KeyboardEvent) => void;

  constructor(containerEl: HTMLElement, deps: McpSettingsManagerDeps) {
    this.app = deps.app;
    this.mountEl = containerEl.createDiv({ cls: 'claudian-mcp-settings-mount' });
    this.root = createPreactRoot(this.mountEl);
    this.mcpStorage = deps.mcpStorage;
    this.broadcastMcpReload = deps.broadcastMcpReload;

    this.settingsDocument = containerEl.ownerDocument ?? window.document;
    this.handleDocumentClick = (event) => {
      if (!this.mountEl.contains(event.target as Node)) {
        this.setMenuOpen(false);
      }
    };
    this.handleDocumentKeydown = (event) => {
      if (event.key === 'Escape' && this.menuOpen) {
        event.preventDefault();
        this.setMenuOpen(false);
        this.mountEl.querySelector<HTMLButtonElement>('.claudian-settings-action-btn')?.focus();
      }
    };
    this.settingsDocument.addEventListener('click', this.handleDocumentClick);
    this.settingsDocument.addEventListener('keydown', this.handleDocumentKeydown);
    managerDestructors.set(this.mountEl, () => this.destroy());
    void this.loadAndRender();
  }

  private async loadAndRender() {
    this.servers = await this.mcpStorage.load();
    if (this.destroyed) return;
    this.render();
  }

  private render() {
    if (this.destroyed) return;
    const servers: McpSettingsViewServer[] = this.servers.map(server => {
      const type = getMcpServerType(server.config);
      return {
        name: server.name,
        type,
        enabled: server.enabled,
        contextSaving: server.contextSaving,
        contextSavingTitle: `Context-saving: mention with @${server.name} to enable`,
        preview: this.getServerPreview(server, type),
        description: server.description,
      };
    });
    this.root.render(h(McpSettingsView, {
      menuId: this.menuId,
      menuOpen: this.menuOpen,
      servers,
      onToggleMenu: () => this.setMenuOpen(!this.menuOpen),
      onAddStdio: () => {
        this.setMenuOpen(false);
        this.openModal(null, 'stdio');
      },
      onAddHttp: () => {
        this.setMenuOpen(false);
        this.openModal(null, 'http');
      },
      onImport: () => {
        this.setMenuOpen(false);
        this.openImportModal();
      },
      onTest: (name) => {
        const server = this.servers.find(item => item.name === name);
        if (server) void this.testServer(server);
      },
      onToggleServer: (name) => {
        const server = this.servers.find(item => item.name === name);
        if (server) {
          void this.toggleServer(server).catch((error: unknown) => {
            this.showMutationError(error, 'Failed to update MCP server');
          });
        }
      },
      onEdit: (name) => {
        const server = this.servers.find(item => item.name === name);
        if (server) this.openModal(server);
      },
      onDelete: (name) => {
        const server = this.servers.find(item => item.name === name);
        if (server) {
          void this.deleteServer(server).catch((error: unknown) => {
            this.showMutationError(error, 'Failed to delete MCP server');
          });
        }
      },
    }));
  }

  private setMenuOpen(open: boolean): void {
    if (this.destroyed || this.menuOpen === open) return;
    this.menuOpen = open;
    this.render();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    managerDestructors.delete(this.mountEl);
    this.settingsDocument.removeEventListener('click', this.handleDocumentClick);
    this.settingsDocument.removeEventListener('keydown', this.handleDocumentKeydown);
    this.root.unmount();
    this.mountEl.remove();
  }

  private async testServer(server: ManagedMcpServer) {
    const modal = new McpTestModal(
      this.app,
      server.name,
      server.disabledTools,
      async (toolName, enabled) => {
        await this.updateDisabledTool(server, toolName, enabled);
      },
      async (disabledTools) => {
        await this.updateAllDisabledTools(server, disabledTools);
      }
    );
    modal.open();

    try {
      const { testMcpServer } = await import('../../core/mcp/McpTester');
      const result = await testMcpServer(server);
      modal.setResult(result);
    } catch (error) {
      modal.setError(error instanceof Error ? error.message : 'Verification failed');
    }
  }

  /** Rolls back on save failure; warns on reload failure (since save succeeded). */
  private async updateServerDisabledTools(
    server: ManagedMcpServer,
    newDisabledTools: string[] | undefined
  ): Promise<void> {
    const previous = server.disabledTools ? [...server.disabledTools] : undefined;
    server.disabledTools = newDisabledTools;

    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      server.disabledTools = previous;
      throw error;
    }

    try {
      await this.broadcastMcpReload();
    } catch {
      // Save succeeded but reload failed - don't rollback since disk has correct state
      new Notice('Setting saved but reload failed. Changes will apply on next session.');
    }
  }

  private async updateDisabledTool(
    server: ManagedMcpServer,
    toolName: string,
    enabled: boolean
  ) {
    const disabledTools = new Set(server.disabledTools ?? []);
    if (enabled) {
      disabledTools.delete(toolName);
    } else {
      disabledTools.add(toolName);
    }
    await this.updateServerDisabledTools(
      server,
      disabledTools.size > 0 ? Array.from(disabledTools) : undefined
    );
  }

  private async updateAllDisabledTools(server: ManagedMcpServer, disabledTools: string[]) {
    await this.updateServerDisabledTools(
      server,
      disabledTools.length > 0 ? disabledTools : undefined
    );
  }

  private getServerPreview(server: ManagedMcpServer, type: McpServerType): string {
    if (type === 'stdio') {
      const config = server.config as { command: string; args?: string[] };
      return formatCommand(config.command, config.args);
    } else {
      const config = server.config as { url: string };
      return config.url;
    }
  }

  private openModal(existing: ManagedMcpServer | null, initialType?: McpServerType) {
    const modal = new McpServerModal(
      this.app,
      existing,
      (server) => {
        void this.saveServer(server, existing).catch((error: unknown) => {
          this.showMutationError(error, 'Failed to save MCP server');
        });
      },
      initialType
    );
    modal.open();
  }

  private openImportModal(): void {
    const modal = new McpImportModal(
      this.app,
      (config) => this.importPastedConfig(config),
    );
    modal.open();
  }

  private async importPastedConfig(text: string): Promise<boolean> {
    try {
      const parsed = tryParseClipboardConfig(text);
      if (!parsed || parsed.servers.length === 0) {
        new Notice('No valid mcp configuration found');
        return false;
      }

      if (parsed.needsName || parsed.servers.length === 1) {
        const server = parsed.servers[0];
        const type = getMcpServerType(server.config);
        const modal = new McpServerModal(
          this.app,
          null,
          (savedServer) => {
            void this.saveServer(savedServer, null).catch((error: unknown) => {
              this.showMutationError(error, 'Failed to save MCP server');
            });
          },
          type,
          server  // Pre-fill with parsed config
        );
        modal.open();
        if (parsed.needsName) {
          new Notice('Enter a name for the server');
        }
        return true;
      }

      await this.importServers(parsed.servers);
      return true;
    } catch (error) {
      this.showMutationError(error, 'Failed to import MCP configuration');
      return false;
    }
  }

  private async saveServer(server: ManagedMcpServer, existing: ManagedMcpServer | null) {
    const previousServers = [...this.servers];
    if (existing) {
      const index = this.servers.findIndex((s) => s.name === existing.name);
      if (index !== -1) {
        if (server.name !== existing.name) {
          const conflict = this.servers.find((s) => s.name === server.name);
          if (conflict) {
            new Notice(`Server "${server.name}" already exists`);
            return;
          }
        }
        this.servers[index] = server;
      }
    } else {
      const conflict = this.servers.find((s) => s.name === server.name);
      if (conflict) {
        new Notice(`Server "${server.name}" already exists`);
        return;
      }
      this.servers.push(server);
    }

    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      this.servers = previousServers;
      throw error;
    }
    await this.broadcastMcpReload();
    this.render();
    new Notice(existing ? `MCP server "${server.name}" updated` : `MCP server "${server.name}" added`);
  }

  private async importServers(servers: Array<{ name: string; config: McpServerConfig }>) {
    const previousServers = [...this.servers];
    const added: string[] = [];
    const skipped: string[] = [];

    for (const server of servers) {
      const name = server.name.trim();
      if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
        skipped.push(server.name || '<unnamed>');
        continue;
      }

      const conflict = this.servers.find((s) => s.name === name);
      if (conflict) {
        skipped.push(name);
        continue;
      }

      this.servers.push({
        name,
        config: server.config,
        enabled: DEFAULT_MCP_SERVER.enabled,
        contextSaving: DEFAULT_MCP_SERVER.contextSaving,
      });
      added.push(name);
    }

    if (added.length === 0) {
      new Notice('No new mcp servers imported');
      return;
    }

    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      this.servers = previousServers;
      throw error;
    }
    await this.broadcastMcpReload();
    this.render();

    let message = `Imported ${added.length} MCP server${added.length > 1 ? 's' : ''}`;
    if (skipped.length > 0) {
      message += ` (${skipped.length} skipped)`;
    }
    new Notice(message);
  }

  private async toggleServer(server: ManagedMcpServer) {
    const previousEnabled = server.enabled;
    server.enabled = !server.enabled;
    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      server.enabled = previousEnabled;
      throw error;
    }
    await this.broadcastMcpReload();
    this.render();
    new Notice(`MCP server "${server.name}" ${server.enabled ? 'enabled' : 'disabled'}`);
  }

  private async deleteServer(server: ManagedMcpServer) {
    if (!(await confirmDelete(this.app, `Delete MCP server "${server.name}"?`))) {
      return;
    }

    const previousServers = this.servers;
    this.servers = this.servers.filter((s) => s.name !== server.name);
    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      this.servers = previousServers;
      throw error;
    }
    await this.broadcastMcpReload();
    this.render();
    new Notice(`MCP server "${server.name}" deleted`);
  }

  /** Refresh the server list (call after external changes). */
  public refresh() {
    void this.loadAndRender();
  }

  private showMutationError(error: unknown, fallback: string): void {
    if (isNotifiedMutationError(error)) {
      return;
    }
    new Notice(error instanceof Error ? error.message : fallback);
  }
}
