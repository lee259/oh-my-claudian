import type { ProviderCliOperation } from '@/core/providers/cli/ProviderCliLifecycle';
import { t } from '@/i18n/i18n';

/** Native command output and Claudian verification are independent evidence. */
export function ProviderCliOperationReply({ operation }: { operation?: ProviderCliOperation }) {
  if (!operation) return null;
  const result = operation.commandResult;
  const hasOutput = Boolean(result?.stdout || result?.stderr);
  return (
    <div className="claudian-cli-operation-reply">
      {operation.error && !hasOutput && !operation.verificationError && (
        <div className="claudian-cli-lifecycle-error" role="alert">
          {t('settings.cliUpdates.localError')} {operation.error}
        </div>
      )}
      {operation.verificationError && (
        <div className="claudian-cli-lifecycle-error" role="alert">
          {t('settings.cliUpdates.verification')} {operation.verificationError}
        </div>
      )}
      {result && (
        <details open={operation.status === 'failed'}>
          <summary>{t('settings.cliUpdates.upstreamReply')}</summary>
          <div className="claudian-cli-operation-meta">
            {t('settings.cliUpdates.exitCode')} {result.exitCode ?? '—'}
            {result.termination && ` · ${result.termination}`}
          </div>
          {result.error && <pre>{result.error}</pre>}
          {result.stdout && <pre aria-label="stdout">{result.stdout}</pre>}
          {result.stderr && <pre aria-label="stderr">{result.stderr}</pre>}
          {!hasOutput && !result.error && <p>{t('settings.cliUpdates.noReply')}</p>}
          {result.outputTruncated && <p>{t('settings.cliUpdates.outputTruncated')}</p>}
        </details>
      )}
    </div>
  );
}
