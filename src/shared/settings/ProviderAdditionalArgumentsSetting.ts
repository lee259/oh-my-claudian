import { Setting } from 'obsidian';

import { setProviderAdditionalArguments } from '../../core/providers/ProviderAdditionalArguments';
import type { ProviderHost } from '../../core/providers/ProviderHost';
import type { ProviderId } from '../../core/providers/types';
import { t } from '../../i18n/i18n';

export function renderProviderAdditionalArgumentsSetting(
  container: HTMLElement,
  plugin: ProviderHost,
  providerId: ProviderId,
): void {
  new Setting(container)
    .setName(t('settings.providerArguments.heading'))
    .setHeading();

  new Setting(container)
    .setName(t('settings.providerArguments.name'))
    .setDesc(t('settings.providerArguments.desc'))
    .addTextArea((text) => {
      text
        .setValue(plugin.settings.providerAdditionalArguments?.[providerId] ?? '')
        .setPlaceholder(t('settings.providerArguments.placeholder'));
      text.inputEl.rows = 4;
      text.inputEl.cols = 32;
      text.inputEl.addEventListener('blur', () => {
        const value = text.inputEl.value;
        if (value === (plugin.settings.providerAdditionalArguments?.[providerId] ?? '')) return;
        void plugin.applyProviderRuntimeSettings([providerId], (settings) => {
          setProviderAdditionalArguments(settings, providerId, value);
        });
      });
    });
}
