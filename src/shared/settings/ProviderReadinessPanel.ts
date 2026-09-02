import { Setting } from 'obsidian';

import type {
  ProviderReadinessCheck,
  ProviderReadinessRemediation,
  ProviderReadinessSnapshot,
  ProviderReadinessStatus,
} from '../../core/providers/ProviderReadiness';
import { t } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';

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
  /** Stable container for CLI lifecycle content, rendered below the checks.
   *  Unlike `root`, it is not cleared on refresh, so a CLI lifecycle section
   *  attached here keeps its own state. */
  cliDetail: HTMLElement;
}

const MIN_REFRESH_FEEDBACK_MS = 120;

export function renderProviderReadinessPanel(
  options: ProviderReadinessPanelOptions,
): ProviderReadinessPanelController {
  const root = options.container.createDiv({ cls: 'claudian-provider-readiness' });
  new Setting(root)
    .setName(t('settings.providerReadiness.title'))
    .setDesc(t('settings.providerReadiness.desc', { provider: options.providerName }))
    .setHeading();

  const summary = root.createDiv({ cls: 'claudian-provider-readiness-summary' });
  const checks = root.createDiv({ cls: 'claudian-provider-readiness-checks' });
  const cliDetail = root.createDiv({ cls: 'claudian-provider-readiness-cli-detail' });

  const renderSnapshot = (snapshot: ProviderReadinessSnapshot): void => {
    summary.setText(t(`settings.providerReadiness.status.${snapshot.status}`));
    if (summary.dataset) summary.dataset.status = snapshot.status;
    checks.empty?.();
    for (const check of snapshot.checks) {
      renderCheck(checks, check);
    }
  };

  const refresh = async (refreshCatalog = false): Promise<void> => {
    summary.setText(t('settings.providerReadiness.checking'));
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
  return { refresh, root, cliDetail };
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
