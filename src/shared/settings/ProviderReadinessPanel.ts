import { Setting } from 'obsidian';

import type {
  ProviderReadinessCheck,
  ProviderReadinessRemediation,
  ProviderReadinessSnapshot,
  ProviderReadinessStatus,
} from '../../core/providers/ProviderReadiness';
import { t } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';
import { renderCliInstallationCard } from './CliInstallationCard';

export interface ProviderReadinessPanelOptions {
  container: HTMLElement;
  providerName: string;
  getSnapshot: () => Promise<ProviderReadinessSnapshot>;
  onRefresh?: () => Promise<void>;
}

export interface ProviderReadinessPanelController {
  /** Re-run the readiness check and re-render. Pass true to also refresh the
   *  provider catalog (e.g. re-run model discovery) first. */
  refresh(refreshCatalog?: boolean): Promise<void>;
  /** Root container element, for appending related content (e.g. CLI lifecycle). */
  root: HTMLElement;
  /** Stable container for provider enablement and CLI path controls. */
  management: HTMLElement;
  /** Stable container for CLI lifecycle content, rendered below the checks.
   *  Unlike `root`, it is not cleared on refresh, so a CLI lifecycle section
   *  attached here keeps its own state. */
  cliDetail: HTMLElement;
  /** Unmount the Preact card and remove the readiness panel from its host. */
  destroy(): void;
}

const MIN_REFRESH_FEEDBACK_MS = 120;

export function renderProviderReadinessPanel(
  options: ProviderReadinessPanelOptions,
): ProviderReadinessPanelController {
  const installationCard = renderCliInstallationCard({
    container: options.container,
    label: `${options.providerName} CLI`,
  });
  const root = installationCard.card;
  root.addClass?.('claudian-provider-readiness');
  const management = installationCard.body.createDiv({ cls: 'claudian-cli-installation-management' });
  new Setting(installationCard.body)
    .setName(t('settings.providerReadiness.title'))
    .setDesc(t('settings.providerReadiness.desc', { provider: options.providerName }))
    .setHeading();

  const summary = installationCard.body.createDiv({ cls: 'claudian-provider-readiness-summary' });
  const checks = installationCard.body.createDiv({ cls: 'claudian-provider-readiness-checks' });
  const cliDetail = installationCard.body.createDiv({ cls: 'claudian-provider-readiness-cli-detail' });

  const renderSnapshot = (snapshot: ProviderReadinessSnapshot): void => {
    const statusText = t(`settings.providerReadiness.status.${snapshot.status}`);
    summary.setText(statusText);
    installationCard.setStatus(snapshot.status, statusText);
    if (summary.dataset) summary.dataset.status = snapshot.status;
    checks.empty?.();
    for (const check of snapshot.checks) {
      renderCheck(checks, check);
    }
  };

  const refresh = async (refreshCatalog = false): Promise<void> => {
    const checkingText = t('settings.providerReadiness.checking');
    summary.setText(checkingText);
    installationCard.setStatus('checking', checkingText);
    if (refreshCatalog) {
      const startedAt = Date.now();
      await options.onRefresh?.();
      const remaining = MIN_REFRESH_FEEDBACK_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, remaining));
      }
    }
    renderSnapshot(await options.getSnapshot());
  };

  void refresh();
  return {
    refresh,
    root,
    management,
    cliDetail,
    destroy: installationCard.destroy,
  };
}

function renderCheck(container: HTMLElement, check: ProviderReadinessCheck): void {
  const row = container.createDiv({ cls: 'claudian-provider-readiness-check' });
  if (row.dataset) row.dataset.status = check.status;
  createReadinessSpan(row, {
    cls: 'claudian-provider-readiness-check-icon',
    text: getStatusIcon(check.status),
  });
  createReadinessSpan(row, {
    cls: 'claudian-provider-readiness-check-label',
    text: t(`settings.providerReadiness.check.${check.id}`),
  });
  createReadinessSpan(row, {
    cls: 'claudian-provider-readiness-check-status',
    text: t(`settings.providerReadiness.status.${check.status}`),
  });
  if (check.remediation) {
    row.createDiv({
      cls: 'claudian-provider-readiness-check-hint',
      text: t(getRemediationTranslationKey(check.remediation)),
    });
  }
}

function getRemediationTranslationKey(remediation: ProviderReadinessRemediation): TranslationKey {
  return `settings.providerReadiness.hint.${remediation}`;
}

interface ReadinessSpanOptions {
  cls: string;
  text: string;
}

interface ObsidianElementHelpers {
  createSpan?: (options: ReadinessSpanOptions) => HTMLElement;
  createEl?: (tag: string, options: ReadinessSpanOptions) => HTMLElement;
}

function createReadinessSpan(
  row: HTMLElement,
  options: ReadinessSpanOptions,
): HTMLElement {
  const helpers = row as HTMLElement & ObsidianElementHelpers;
  if (typeof helpers.createSpan === 'function') {
    return helpers.createSpan(options);
  }

  if (typeof helpers.createEl === 'function') {
    return helpers.createEl.call(row, 'span', options);
  }

  throw new Error('Obsidian element does not support span creation.');
}

function getStatusIcon(status: ProviderReadinessStatus): string {
  switch (status) {
    case 'ready': return '✓';
    case 'attention': return '!';
    case 'blocked': return '×';
    case 'disabled': return '–';
  }
}
