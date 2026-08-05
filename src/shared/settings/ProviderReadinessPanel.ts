import { Setting } from 'obsidian';

import type {
  ProviderReadinessCheck,
  ProviderReadinessSnapshot,
  ProviderReadinessStatus,
} from '../../core/providers/ProviderReadiness';
import { t } from '../../i18n/i18n';

export interface ProviderReadinessPanelOptions {
  container: HTMLElement;
  providerName: string;
  getSnapshot: () => Promise<ProviderReadinessSnapshot>;
  onRefresh?: () => Promise<void>;
}

export function renderProviderReadinessPanel(
  options: ProviderReadinessPanelOptions,
): void {
  const root = options.container.createDiv({ cls: 'claudian-provider-readiness' });
  new Setting(root)
    .setName(t('settings.providerReadiness.title'))
    .setDesc(t('settings.providerReadiness.desc', { provider: options.providerName }))
    .setHeading();

  const summary = root.createDiv({ cls: 'claudian-provider-readiness-summary' });
  const checks = root.createDiv({ cls: 'claudian-provider-readiness-checks' });
  const action = new Setting(root);
  let refreshButton: HTMLButtonElement | null = null;

  action.addButton(button => {
    refreshButton = button.buttonEl;
    button.setButtonText(t('settings.providerReadiness.refresh'));
    button.onClick(() => { void refresh(true); });
  });

  const renderSnapshot = (snapshot: ProviderReadinessSnapshot): void => {
    summary.setText(t(`settings.providerReadiness.status.${snapshot.status}`));
    summary.dataset.status = snapshot.status;
    checks.empty();
    for (const check of snapshot.checks) {
      renderCheck(checks, check);
    }
  };

  const refresh = async (refreshCatalog = false): Promise<void> => {
    if (refreshButton) refreshButton.disabled = true;
    summary.setText(t('settings.providerReadiness.checking'));
    try {
      if (refreshCatalog) {
        await options.onRefresh?.();
      }
      renderSnapshot(await options.getSnapshot());
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  };

  void refresh();
}

function renderCheck(container: HTMLElement, check: ProviderReadinessCheck): void {
  const row = container.createDiv({ cls: 'claudian-provider-readiness-check' });
  row.dataset.status = check.status;
  row.createSpan({
    cls: 'claudian-provider-readiness-check-icon',
    text: getStatusIcon(check.status),
  });
  row.createSpan({
    cls: 'claudian-provider-readiness-check-label',
    text: t(`settings.providerReadiness.check.${check.id}`),
  });
  row.createSpan({
    cls: 'claudian-provider-readiness-check-status',
    text: t(`settings.providerReadiness.status.${check.status}`),
  });
}

function getStatusIcon(status: ProviderReadinessStatus): string {
  switch (status) {
    case 'ready': return '✓';
    case 'attention': return '!';
    case 'blocked': return '×';
    case 'disabled': return '–';
  }
}
