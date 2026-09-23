import { Setting } from 'obsidian';
import { h } from 'preact';

import type {
  ProviderReadinessCheck,
  ProviderReadinessRemediation,
  ProviderReadinessSnapshot,
  ProviderReadinessStatus,
} from '../../core/providers/ProviderReadiness';
import { t } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';
import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { renderCliInstallationCard } from './CliInstallationCard';
import { ProviderReadinessView, type ProviderReadinessViewCheck } from './ProviderReadinessView';

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
  /** Unmount both Preact views and remove the readiness panel from its host. */
  destroy(): void;
}

const MIN_REFRESH_FEEDBACK_MS = 120;
const readinessDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount readiness roots before settings hosts clear their provider cards. */
export function destroyProviderReadinessPanels(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-provider-readiness-view-mount'),
  );
  if (container.classList.contains('claudian-provider-readiness-view-mount')) mounts.unshift(container);
  mounts.forEach(mount => readinessDestructors.get(mount)?.());
}

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

  const mount = installationCard.body.createDiv({ cls: 'claudian-provider-readiness-view-mount' });
  const viewRoot: PreactRoot = createPreactRoot(mount);
  const cliDetail = installationCard.body.createDiv({ cls: 'claudian-provider-readiness-cli-detail' });
  let destroyed = false;
  let currentChecks: ProviderReadinessViewCheck[] = [];

  const renderView = (
    status: ProviderReadinessStatus | 'checking',
    summary: string,
    checks = currentChecks,
  ): void => {
    if (destroyed) return;
    currentChecks = checks;
    viewRoot.render(h(ProviderReadinessView, { status, summary, checks: currentChecks }));
  };

  const dispose = (): void => {
    if (destroyed) return;
    destroyed = true;
    readinessDestructors.delete(mount);
    viewRoot.unmount();
    installationCard.destroy();
  };
  readinessDestructors.set(mount, dispose);

  const renderSnapshot = (snapshot: ProviderReadinessSnapshot): void => {
    const statusText = t(`settings.providerReadiness.status.${snapshot.status}`);
    renderView(snapshot.status, statusText, snapshot.checks.map(toReadinessViewCheck));
    installationCard.setStatus(snapshot.status, statusText);
  };

  const refresh = async (refreshCatalog = false): Promise<void> => {
    if (destroyed) return;
    const checkingText = t('settings.providerReadiness.checking');
    renderView('checking', checkingText);
    installationCard.setStatus('checking', checkingText);
    if (refreshCatalog) {
      const startedAt = Date.now();
      await options.onRefresh?.();
      if (destroyed) return;
      const remaining = MIN_REFRESH_FEEDBACK_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, remaining));
      }
    }
    if (destroyed) return;
    const snapshot = await options.getSnapshot();
    if (destroyed) return;
    renderSnapshot(snapshot);
  };

  renderView('checking', t('settings.providerReadiness.checking'), []);
  void refresh();
  return {
    refresh,
    root,
    management,
    cliDetail,
    destroy: dispose,
  };
}

function toReadinessViewCheck(check: ProviderReadinessCheck): ProviderReadinessViewCheck {
  return {
    id: check.id,
    status: check.status,
    icon: getStatusIcon(check.status),
    label: t(`settings.providerReadiness.check.${check.id}`),
    statusLabel: t(`settings.providerReadiness.status.${check.status}`),
    ...(check.remediation ? { hint: t(getRemediationTranslationKey(check.remediation)) } : {}),
  };
}

function getRemediationTranslationKey(remediation: ProviderReadinessRemediation): TranslationKey {
  return `settings.providerReadiness.hint.${remediation}`;
}

function getStatusIcon(status: ProviderReadinessStatus): string {
  switch (status) {
    case 'ready': return '✓';
    case 'attention': return '!';
    case 'blocked': return '×';
    case 'disabled': return '–';
  }
}
