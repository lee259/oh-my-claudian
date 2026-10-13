import { ProviderCliOperationReply } from './ProviderCliOperationReply';
import type { CliVersionInfo } from '../../core/providers/cli/CliProviderMetadata';
import type { ProviderCliOperation } from '../../core/providers/cli/ProviderCliLifecycle';
import { t } from '../../i18n/i18n';

export type CliLifecycleAction = 'install' | 'update' | 'check' | null;

export interface CliLifecycleViewProps {
  updateHint?: string;
  operation?: ProviderCliOperation;
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
  updateHint,
  operation,
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
      <div className="claudian-cli-lifecycle-overview">
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
          {updateHint && <span className="claudian-cli-lifecycle-hint">{updateHint}</span>}
          {info?.installedButBroken && (
            <span className="claudian-cli-lifecycle-hint">
              {t('settings.cliLifecycle.checkEnv')}
            </span>
          )}
          <div className="claudian-cli-lifecycle-action-row">
            {canInstall && (
              <button
                type="button"
                className="claudian-cli-lifecycle-button"
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
                className="claudian-cli-lifecycle-button"
                disabled={pendingAction !== null}
                onClick={onUpdate}
              >
                {pendingAction === 'update'
                  ? t('settings.cliLifecycle.updating')
                  : t('settings.cliLifecycle.update')}
              </button>
            )}
            {info?.version && info.latestVersion && !info.installedButBroken && !isUpdateAvailable && (
              <span className="claudian-cli-lifecycle-ready">
                {t('settings.cliLifecycle.ready')}
              </span>
            )}
            {onCheckAgain && (
              <button
                type="button"
                className="claudian-cli-lifecycle-button claudian-cli-lifecycle-check"
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
      <ProviderCliOperationReply operation={operation} />
      {operation?.status === 'verified' && (
        <div className="claudian-cli-lifecycle-ready" role="status">
          {t('settings.cliLifecycle.operationVerified')}
        </div>
      )}
      {operation?.warning && (
        <div className="claudian-cli-lifecycle-error" role="status">
          {t('settings.cliUpdates.modelWarning')} {operation.warning}
        </div>
      )}
    </div>
  );
}
