export type CliInstallationCardViewState =
  | 'checking'
  | 'disabled'
  | 'blocked'
  | 'attention'
  | 'ready';

export interface CliInstallationCardViewProps {
  label: string;
  bodyId: string;
  state: CliInstallationCardViewState;
  statusText: string;
  expanded: boolean;
  onToggle: () => void;
  bodyRef: (body: HTMLElement | null) => void;
}

export function CliInstallationCardView({
  label,
  bodyId,
  state,
  statusText,
  expanded,
  onToggle,
  bodyRef,
}: CliInstallationCardViewProps) {
  const headerId = `${bodyId}-header`;
  const statusId = `${bodyId}-status`;

  return (
    <div className="claudian-cli-installation" data-state={state}>
      <div className="claudian-cli-installation-heading">
        <button
          className="claudian-cli-installation-header"
          type="button"
          aria-label={`${label} CLI details`}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-describedby={statusId}
          id={headerId}
          onClick={onToggle}
        >
          <span className="claudian-cli-installation-icon" aria-hidden="true">
            ⌘
            <span className="claudian-cli-installation-dot" data-state={state} />
          </span>
          <span className="claudian-cli-installation-summary">
            <span className="claudian-cli-installation-title">{label}</span>
            <span
              className="claudian-cli-installation-status"
              id={statusId}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {statusText}
            </span>
          </span>
          <span className="claudian-cli-installation-chevron" aria-hidden="true">
            {expanded ? '⌄' : '›'}
          </span>
        </button>
      </div>
      <div
        className="claudian-cli-installation-body"
        id={bodyId}
        hidden={!expanded}
        role="region"
        aria-labelledby={headerId}
        ref={bodyRef}
      />
    </div>
  );
}
