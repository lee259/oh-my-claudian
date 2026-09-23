import type { CliVersionInfo } from '../../core/providers/cli/CliProviderMetadata';
import { t } from '../../i18n/i18n';

export type CliLifecycleAction = 'install' | 'update' | 'check' | null;

export interface CliLifecycleViewProps {
  statusText: string;
  info: CliVersionInfo | null;
  errorText?: string;
  canInstall: boolean;
  canUpdate: boolean;
  isUpdateAvailable: boolean;
  pendingAction: CliLifecycleAction;
  onInstall: () => void;
  onUpdate: () => void;
  onCheckAgain?: () => void;
}

export function CliLifecycleView({
  statusText,
  info,
  errorText,
  canInstall,
  canUpdate,
  isUpdateAvailable,
  pendingAction,
  onInstall,
  onUpdate,
  onCheckAgain,
}: CliLifecycleViewProps) {
  return (
    <div className="claudian-cli-lifecycle">
      <div className="claudian-cli-lifecycle-status" aria-live="polite">
        {info ? (
          <>
            <div className="claudian-cli-lifecycle-version-item">
              <span>{t('settings.cliLifecycle.currentVersion')}: </span>
              {info.installedButBroken ? (
                <span
                  className="claudian-cli-lifecycle-version-broken"
                  title={info.error ?? undefined}
                >
                  {t('settings.cliLifecycle.installedButBroken')}
                </span>
              ) : info.version ? (
                <span className="claudian-cli-lifecycle-version-value">{info.version}</span>
              ) : (
                <span className="claudian-cli-lifecycle-version-not-installed">
                  {t('settings.cliLifecycle.notInstalled')}
                </span>
              )}
            </div>
            {info.latestVersion && (
              <>
                <div className="claudian-cli-lifecycle-version-item">
                  <span>{t('settings.cliLifecycle.latestVersion')}: </span>
                  <span className="claudian-cli-lifecycle-version-value">{info.latestVersion}</span>
                </div>
                {isUpdateAvailable && (
                  <div className="claudian-cli-lifecycle-update-badge">
                    {t('settings.cliLifecycle.updateAvailable', { version: info.latestVersion })}
                  </div>
                )}
              </>
            )}
            {info.error && !info.version && !info.installedButBroken && (
              <div className="claudian-cli-lifecycle-error">{errorText ?? info.error}</div>
            )}
          </>
        ) : statusText ? statusText : null}
      </div>
      <div className="claudian-cli-lifecycle-actions">
        {info?.installedButBroken && (
          <span className="claudian-cli-lifecycle-hint">
            {t('settings.cliLifecycle.checkEnv')}
          </span>
        )}
        <div className="claudian-cli-lifecycle-action-row">
          {canInstall && (
            <button
              type="button"
              className="mod-cta"
              disabled={pendingAction !== null}
              onClick={onInstall}
            >
              {pendingAction === 'install'
                ? t('settings.cliLifecycle.installing')
                : t('settings.cliLifecycle.install')}
            </button>
          )}
          {canUpdate && (
            <button
              type="button"
              className="mod-cta"
              disabled={pendingAction !== null}
              onClick={onUpdate}
            >
              {pendingAction === 'update'
                ? t('settings.cliLifecycle.updating')
                : t('settings.cliLifecycle.update')}
            </button>
          )}
          {info?.version && !info.installedButBroken && !isUpdateAvailable && (
            <span className="claudian-cli-lifecycle-ready">
              {t('settings.cliLifecycle.ready')}
            </span>
          )}
          {onCheckAgain && (
            <button
              type="button"
              className="claudian-cli-lifecycle-check"
              disabled={pendingAction !== null}
              onClick={onCheckAgain}
            >
              {pendingAction === 'check'
                ? t('settings.providerReadiness.checking')
                : t('settings.providerReadiness.refresh')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
