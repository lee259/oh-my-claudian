export type CliInstallationCardViewState =
  | 'checking'
  | 'disabled'
  | 'blocked'
  | 'attention'
  | 'ready';

export interface CliInstallationCardViewProps {
  label: string;
  version: string;
  sourceText: string;
  path: string;
  headerToggle?: {
    name: string;
    description?: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => Promise<void> | void;
  };
  bodyId: string;
  state: CliInstallationCardViewState;
  statusText: string;
  expanded: boolean;
  onToggle: () => void;
  bodyRef: (body: HTMLElement | null) => void;
}

export function CliInstallationCardView({
  label,
  version,
  sourceText,
  path,
  headerToggle,
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
            <span className="claudian-cli-installation-title">
              {label}
              {version && <span className="claudian-cli-installation-version">{version}</span>}
            </span>
            {sourceText && <span className="claudian-cli-installation-source">{sourceText}</span>}
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
        {headerToggle && (
          <div className="claudian-cli-installation-header-actions">
            <input
              aria-label={headerToggle.name}
              aria-disabled={headerToggle.disabled}
              title={headerToggle.description}
              checked={headerToggle.checked}
              disabled={headerToggle.disabled}
              role="switch"
              type="checkbox"
              onChange={(event) => headerToggle.onChange(event.currentTarget.checked)}
            />
          </div>
        )}
      </div>
      {path && (
        <div className="claudian-cli-installation-path" title={path}>
          <code>{path}</code>
        </div>
      )}
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
