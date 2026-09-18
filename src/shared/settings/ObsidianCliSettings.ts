import { Setting } from 'obsidian';

import {
  OBSIDIAN_CLI_SETUP_URL,
  type ObsidianWorkspaceAdapter,
} from '../../core/obsidian/ObsidianWorkspaceAdapter';
import { t } from '../../i18n/i18n';

/** Renders the capability status without making CLI setup a hard dependency. */
export function renderObsidianCliSettings(
  container: HTMLElement,
  adapter: ObsidianWorkspaceAdapter,
): void {
  new Setting(container)
    .setName(t('settings.obsidianCli.title'))
    .setDesc(t('settings.obsidianCli.desc'))
    .setHeading();

  const status = container.createDiv({ cls: 'claudian-obsidian-cli-status' });
  const actions = container.createDiv({ cls: 'claudian-obsidian-cli-actions' });

  const refresh = async (): Promise<void> => {
    status.setText(t('settings.obsidianCli.checking'));
    actions.empty();

    try {
      const snapshot = await adapter.probe();
      if (snapshot.cli.available) {
        const version = snapshot.cli.version
          ? ` (${snapshot.cli.version})`
          : '';
        status.setText(t('settings.obsidianCli.available', {
          version,
          path: snapshot.cli.path ?? 'PATH',
        }));
      } else {
        status.setText(t('settings.obsidianCli.notAvailable'));
        const guide = actions.createEl('a', {
          text: t('settings.obsidianCli.openGuide'),
          href: OBSIDIAN_CLI_SETUP_URL,
        });
        guide.target = '_blank';
        guide.rel = 'noopener noreferrer';
      }

      const button = actions.createEl('button', {
        text: t('settings.obsidianCli.checkAgain'),
      });
      button.addEventListener('click', () => {
        button.disabled = true;
        void refresh().finally(() => {
          button.disabled = false;
        });
      });
    } catch {
      status.setText(t('settings.obsidianCli.failed'));
    }
  };

  void refresh();
}
