import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '@/i18n/i18n';

import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerType,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../core/types';
import { formatCommand, parseCommand } from '../../utils/mcp';

export class McpServerModal extends Modal {
  private existingServer: ManagedMcpServer | null;
  private onSave: (server: ManagedMcpServer) => void;

  private serverName = '';
  private serverType: McpServerType = 'stdio';
  private enabled = DEFAULT_MCP_SERVER.enabled;
  private contextSaving = DEFAULT_MCP_SERVER.contextSaving;
  private command = '';
  private env = '';
  private url = '';
  private headers = '';
  private typeFieldsEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    existingServer: ManagedMcpServer | null,
    onSave: (server: ManagedMcpServer) => void,
    initialType?: McpServerType,
    prefillConfig?: { name: string; config: McpServerConfig }
  ) {
    super(app);
    this.existingServer = existingServer;
    this.onSave = onSave;

    if (existingServer) {
      this.serverName = existingServer.name;
      this.serverType = getMcpServerType(existingServer.config);
      this.enabled = existingServer.enabled;
      this.contextSaving = existingServer.contextSaving;
      this.initFromConfig(existingServer.config);
    } else if (prefillConfig) {
      this.serverName = prefillConfig.name;
      this.serverType = getMcpServerType(prefillConfig.config);
      this.initFromConfig(prefillConfig.config);
    } else if (initialType) {
      this.serverType = initialType;
    }
  }

  private initFromConfig(config: McpServerConfig) {
    const type = getMcpServerType(config);
    if (type === 'stdio') {
      const stdioConfig = config as McpStdioServerConfig;
      this.command = formatCommand(stdioConfig.command, stdioConfig.args);
      this.env = this.envRecordToString(stdioConfig.env);
    } else {
      const urlConfig = config as McpSSEServerConfig | McpHttpServerConfig;
      this.url = urlConfig.url;
      this.headers = this.envRecordToString(urlConfig.headers);
    }
  }

  onOpen() {
    this.setTitle(this.existingServer ? t('settings.mcp.edit') : t('settings.mcp.add'));
    this.modalEl.addClass('claudian-mcp-modal');

    const { contentEl } = this;

    new Setting(contentEl)
      .setName(t('settings.mcp.name'))
      .setDesc(t('settings.mcp.nameDesc'))
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.setValue(this.serverName);
        text.setPlaceholder('My-mcp-server');
        text.onChange((value) => {
          this.serverName = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    new Setting(contentEl)
      .setName(t('settings.mcp.type'))
      .setDesc(t('settings.mcp.typeDesc'))
      .addDropdown((dropdown) => {
        dropdown.addOption('stdio', t('settings.mcp.stdio'));
        dropdown.addOption('sse', t('settings.mcp.sse'));
        dropdown.addOption('http', t('settings.mcp.http'));
        dropdown.setValue(this.serverType);
        dropdown.onChange((value) => {
          this.serverType = value as McpServerType;
          this.renderTypeFields();
        });
      });

    this.typeFieldsEl = contentEl.createDiv({ cls: 'claudian-mcp-type-fields' });
    this.renderTypeFields();

    new Setting(contentEl)
      .setName(t('common.enabled'))
      .setDesc(t('settings.mcp.enabledDesc'))
      .addToggle((toggle) => {
        toggle.setValue(this.enabled);
        toggle.onChange((value) => {
          this.enabled = value;
        });
      });

    new Setting(contentEl)
      .setName(t('settings.mcp.contextSaving'))
      .setDesc(t('settings.mcp.contextSavingDesc'))
      .addToggle((toggle) => {
        toggle.setValue(this.contextSaving);
        toggle.onChange((value) => {
          this.contextSaving = value;
        });
      });

    const buttonContainer = contentEl.createDiv({ cls: 'claudian-mcp-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('common.cancel'),
      cls: 'claudian-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.existingServer ? t('common.update') : t('common.add'),
      cls: 'claudian-save-btn mod-cta',
    });
    saveBtn.addEventListener('click', () => this.save());
  }

  private renderTypeFields() {
    if (!this.typeFieldsEl) return;
    this.typeFieldsEl.empty();

    if (this.serverType === 'stdio') {
      this.renderStdioFields();
    } else {
      this.renderUrlFields();
    }
  }

  private renderStdioFields() {
    if (!this.typeFieldsEl) return;

    const cmdSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.command'))
      .setDesc(t('settings.mcp.commandDesc'));
    cmdSetting.settingEl.addClass('claudian-mcp-cmd-setting');

    const cmdTextarea = cmdSetting.controlEl.createEl('textarea', {
      cls: 'claudian-mcp-cmd-textarea',
    });
    cmdTextarea.value = this.command;
    cmdTextarea.placeholder = 'Docker exec -i mcp-server python -m src.server';
    cmdTextarea.rows = 2;
    cmdTextarea.addEventListener('input', () => {
      this.command = cmdTextarea.value;
    });

    const envSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.env'))
      .setDesc(t('settings.mcp.envDesc'));
    envSetting.settingEl.addClass('claudian-mcp-env-setting');

    const envTextarea = envSetting.controlEl.createEl('textarea', {
      cls: 'claudian-mcp-env-textarea',
    });
    envTextarea.value = this.env;
    envTextarea.placeholder = 'API_key=your-key';
    envTextarea.rows = 2;
    envTextarea.addEventListener('input', () => {
      this.env = envTextarea.value;
    });
  }

  private renderUrlFields() {
    if (!this.typeFieldsEl) return;

    new Setting(this.typeFieldsEl)
      .setName('URL')
      .setDesc(this.serverType === 'sse' ? 'SSE endpoint URL' : 'HTTP endpoint URL')
      .addText((text) => {
        text.setValue(this.url);
        text.setPlaceholder('HTTP://localhost:3000/sse');
        text.onChange((value) => {
          this.url = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    const headersSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.headers'))
      .setDesc(t('settings.mcp.headersDesc'));
    headersSetting.settingEl.addClass('claudian-mcp-env-setting');

    const headersTextarea = headersSetting.controlEl.createEl('textarea', {
      cls: 'claudian-mcp-env-textarea',
    });
    headersTextarea.value = this.headers;
    headersTextarea.placeholder = 'Authorization=bearer token\ncontent-type=application/JSON';
    headersTextarea.rows = 3;
    headersTextarea.addEventListener('input', () => {
      this.headers = headersTextarea.value;
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    // !e.isComposing for IME support
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.save();
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.close();
    }
  }

  private save() {
    const name = this.serverName.trim();
    if (!name) {
      new Notice(t('settings.mcp.requireName'));
      this.nameInputEl?.focus();
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      new Notice(t('settings.mcp.invalidName'));
      this.nameInputEl?.focus();
      return;
    }

    let config: McpServerConfig;

    if (this.serverType === 'stdio') {
      const fullCommand = this.command.trim();
      if (!fullCommand) {
        new Notice(t('settings.mcp.requireCommand'));
        return;
      }

      const { cmd, args } = parseCommand(fullCommand);
      const stdioConfig: McpStdioServerConfig = { command: cmd };

      if (args.length > 0) {
        stdioConfig.args = args;
      }

      const env = this.parseEnvString(this.env);
      if (Object.keys(env).length > 0) {
        stdioConfig.env = env;
      }

      config = stdioConfig;
    } else {
      const url = this.url.trim();
      if (!url) {
        new Notice(t('settings.mcp.requireUrl'));
        return;
      }

      if (this.serverType === 'sse') {
        const sseConfig: McpSSEServerConfig = { type: 'sse', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          sseConfig.headers = headers;
        }
        config = sseConfig;
      } else {
        const httpConfig: McpHttpServerConfig = { type: 'http', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          httpConfig.headers = headers;
        }
        config = httpConfig;
      }
    }

    const server: ManagedMcpServer = {
      name,
      config,
      enabled: this.enabled,
      contextSaving: this.contextSaving,
      disabledTools: this.existingServer?.disabledTools,
    };

    this.onSave(server);
    this.close();
  }

  private parseEnvString(envStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!envStr.trim()) return result;

    for (const line of envStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  private envRecordToString(env: Record<string, string> | undefined): string {
    if (!env) return '';
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  onClose() {
    this.contentEl.empty();
  }
}
