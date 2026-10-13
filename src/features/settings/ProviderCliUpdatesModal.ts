import { type App, Modal } from 'obsidian';

import type { ProviderCliLifecyclePort } from '@/core/providers/cli/ProviderCliLifecycle';
import { t } from '@/i18n/i18n';

import { mountProviderCliUpdates } from './ProviderCliUpdates';

export class ProviderCliUpdatesModal extends Modal {
  private disposeUpdates: (() => void) | null = null;

  constructor(app: App, private readonly lifecycle: ProviderCliLifecyclePort) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('settings.cliUpdates.title'));
    this.modalEl.addClass('claudian-cli-updates-modal');
    this.disposeUpdates = mountProviderCliUpdates(this.contentEl, this.app, this.lifecycle, { updatesOnly: true });
  }

  onClose(): void {
    this.disposeUpdates?.();
    this.disposeUpdates = null;
    this.contentEl.empty();
  }
}
