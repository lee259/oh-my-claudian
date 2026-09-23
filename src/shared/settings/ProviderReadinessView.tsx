import type { ProviderReadinessStatus } from '../../core/providers/ProviderReadiness';

export interface ProviderReadinessViewCheck {
  id: string;
  status: ProviderReadinessStatus;
  icon: string;
  label: string;
  statusLabel: string;
  hint?: string;
}

export interface ProviderReadinessViewProps {
  status: ProviderReadinessStatus | 'checking';
  summary: string;
  checks: readonly ProviderReadinessViewCheck[];
}

export function ProviderReadinessView({ status, summary, checks }: ProviderReadinessViewProps) {
  return (
    <>
      <div className="claudian-provider-readiness-summary" data-status={status}>{summary}</div>
      <div className="claudian-provider-readiness-checks">
        {checks.map(check => (
          <div className="claudian-provider-readiness-check" data-status={check.status} key={check.id}>
            <span className="claudian-provider-readiness-check-icon">{check.icon}</span>
            <span className="claudian-provider-readiness-check-label">{check.label}</span>
            <span className="claudian-provider-readiness-check-status">{check.statusLabel}</span>
            {check.hint && <div className="claudian-provider-readiness-check-hint">{check.hint}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
