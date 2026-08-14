import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderHostnameCliPathSetting } from '../../../shared/settings/HostnameCliPathSetting';
import { renderProviderEnablementSetting } from '../../../shared/settings/ProviderEnablementSetting';
import { getHostnameKey } from '../../../utils/env';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';

export const dshSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settings = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = getHostnameKey();
    new Setting(container).setName('Deepseek harness').setHeading();
    new Setting(container)
      .setName('Recommended setup')
      .setDesc('Clone deepseek-harness, run pnpm install and pnpm run build, then configure pnpm as the command. Use one argument per line: --dir, /path/to/deepseek-harness, run, demo:acp. The --dir argument is required so dsh can load its .env and ACP configuration. Make DEEPSEEK_API_KEY available to Obsidian.');
    renderProviderEnablementSetting({
      container,
      description: 'Use DeepSeek Harness through its ACP server.',
      getValue: () => getDshProviderSettings(settings).enabled,
      name: 'Enable dsh',
      onChange: async enabled => {
        await context.plugin.mutateSettings(target => { updateDshProviderSettings(target, { enabled }); });
        context.notifyProviderModelOptionsChanged('dsh');
      },
    });
    renderHostnameCliPathSetting({
      container,
      description: 'Executable or wrapper that speaks dsh ACP over stdio.',
      getValue: () => getDshProviderSettings(settings).cliPathsByHost[hostnameKey] || getDshProviderSettings(settings).cliPath,
      name: 'dsh ACP command',
      onChange: async value => {
        await context.plugin.mutateSettings(target => { updateDshProviderSettings(target, {
          cliPath: value,
          cliPathsByHost: {},
        }); });
      },
      placeholder: 'dsh or node',
    });
    new Setting(container)
      .setName('Model')
      .setDesc('The selected model is substituted for {model} in the arguments below.')
      .addText(text => text
        .setPlaceholder('Deepseek-chat')
        .setValue(getDshProviderSettings(settings).model)
        .onChange(async value => {
          await context.plugin.mutateSettings(target => { updateDshProviderSettings(target, { model: value }); });
          context.notifyProviderModelOptionsChanged('dsh');
        }));
    new Setting(container)
      .setName('Acp arguments')
      .setDesc('One space-separated argument per line. Use {model} where needed.')
      .addTextArea(text => text
        .setValue(getDshProviderSettings(settings).args.join('\n'))
        .onChange(async value => {
          await context.plugin.mutateSettings(target => { updateDshProviderSettings(target, {
            args: value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean),
          }); });
        }));
  },
};
