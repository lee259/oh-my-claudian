import type { ProviderCliSnapshot } from '@/core/providers/cli/ProviderCliLifecycle';
import { t } from '@/i18n/i18n';
import { ProviderCliOperationReply } from '@/shared/settings/ProviderCliOperationReply';

export interface ProviderCliUpdatesViewProps {
  snapshots: readonly ProviderCliSnapshot[];
  preparing: boolean;
  error: string | null;
  onUpdate: (snapshots: readonly ProviderCliSnapshot[]) => void;
  onCheck: () => void;
  onDismiss?: () => void;
}

export function ProviderCliUpdatesView({
  snapshots, preparing, error, onUpdate, onCheck, onDismiss,
}: ProviderCliUpdatesViewProps) {
  const pending = snapshots.filter(snapshot => snapshot.enabled && snapshot.canUpdate && snapshot.operation?.status !== 'running');
  return (
    <section className="claudian-cli-updates" aria-label={t('settings.cliUpdates.title')} onClick={event => event.stopPropagation()}>
      <div className="claudian-cli-updates-heading">
        <strong>{t('settings.cliUpdates.title')}</strong>
        {onDismiss && <button type="button" onClick={onDismiss} aria-label={t('settings.cliUpdates.dismiss')}>×</button>}
      </div>
      <p>{t('settings.cliUpdates.summary')}</p>
      <ul className="claudian-cli-updates-list">
        {snapshots.map(snapshot => (
          <li key={snapshot.providerId} className="claudian-cli-updates-row">
            <div className="claudian-cli-updates-row-heading">
              <strong>{snapshot.displayName}</strong>
              <span className="claudian-cli-updates-version">
                {snapshot.version
                  ? snapshot.latestVersion && snapshot.canUpdate
                    ? `${snapshot.version} → ${snapshot.latestVersion}` : snapshot.version
                  : t(`settings.cliUpdates.${snapshot.status}`)}
              </span>
              {snapshot.operation?.status === 'running' ? (
                <span role="status">{t('settings.cliUpdates.updating')}</span>
              ) : snapshot.operation?.status === 'verified' && !snapshot.canUpdate ? (
                <span role="status">{t('settings.cliUpdates.updated')}</span>
              ) : snapshot.canUpdate ? (
                <button type="button" disabled={preparing} onClick={() => onUpdate([snapshot])}>
                  {t(snapshot.operation?.status === 'failed' ? 'settings.cliUpdates.retry' : 'settings.cliLifecycle.update')}
                </button>
              ) : null}
            </div>
            {snapshot.path && (
              <details className="claudian-cli-updates-installation">
                <summary>{t('settings.cliUpdates.installation')}</summary>
                <div className="claudian-cli-updates-path">{snapshot.path}</div>
              </details>
            )}
            {snapshot.updateHint && <div className="claudian-cli-updates-path">{snapshot.updateHint}</div>}
            {snapshot.error && (
              <div className="claudian-cli-updates-error" role="alert">{snapshot.error}</div>
            )}
            <ProviderCliOperationReply operation={snapshot.operation} />
            {snapshot.operation?.warning && (
              <div className="claudian-cli-updates-error" role="status">
                {t('settings.cliUpdates.modelWarning')} {snapshot.operation.warning}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="claudian-cli-updates-error" role="alert">{error}</div>}
      <div className="claudian-cli-updates-actions">
        <button type="button" disabled={preparing} onClick={onCheck}>
          {t(preparing ? 'settings.cliUpdates.checking' : 'settings.cliUpdates.checkAll')}
        </button>
        {pending.length > 1 && (
          <button type="button" disabled={preparing} onClick={() => onUpdate(pending)}>
            {t('settings.cliUpdates.updateAll')}
          </button>
        )}
      </div>
    </section>
  );
}
