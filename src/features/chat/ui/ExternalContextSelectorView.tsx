import { ObsidianIcon } from '../../../shared/ui/ObsidianIcon';

export interface ExternalContextViewEntry {
  path: string;
  name: string;
  parentPath: string;
  persistent: boolean;
}

export interface ExternalContextSelectorViewProps {
  addFilesAndFoldersLabel: string;
  manageLabel: string;
  managerTitle: string;
  managerDescription: string;
  entries: readonly ExternalContextViewEntry[];
  managerOpen: boolean;
  acrossSessionsLabel: string;
  thisConversationLabel: string;
  persistLabel: string;
  sessionOnlyLabel: string;
  removeLabel: string;
  emptyLabel: string;
  onPickFilesAndFolders: () => void;
  onToggleManager: () => void;
  onTogglePersistence: (path: string) => void;
  onRemove: (path: string) => void;
}

export function ExternalContextSelectorView({
  addFilesAndFoldersLabel,
  manageLabel,
  managerTitle,
  managerDescription,
  entries,
  managerOpen,
  acrossSessionsLabel,
  thisConversationLabel,
  persistLabel,
  sessionOnlyLabel,
  removeLabel,
  emptyLabel,
  onPickFilesAndFolders,
  onToggleManager,
  onTogglePersistence,
  onRemove,
}: ExternalContextSelectorViewProps) {
  return (
    <div className={`claudian-external-context-selector${managerOpen ? ' is-open' : ''}`}>
      <button
        aria-label={addFilesAndFoldersLabel}
        className="claudian-external-context-picker claudian-context-action-button"
        type="button"
        onClick={onPickFilesAndFolders}
      >
        <ObsidianIcon className="claudian-context-action-icon" icon="folder-plus" />
        <span className="claudian-external-context-label">{addFilesAndFoldersLabel}</span>
      </button>
      {entries.length > 0 && (
        <button
          aria-label={manageLabel}
          aria-expanded={managerOpen}
          aria-haspopup="true"
          className="claudian-external-context-manage-button"
          title={manageLabel}
          type="button"
          onClick={onToggleManager}
        >
          <ObsidianIcon icon="list" />
        </button>
      )}
      <div
        aria-label={managerTitle}
        className="claudian-external-context-dropdown"
        hidden={!managerOpen}
        role="region"
      >
        <div className="claudian-external-context-header">
          <span className="claudian-external-context-heading">{managerTitle}</span>
          <span className="claudian-external-context-description">{managerDescription}</span>
        </div>
        {entries.length === 0 ? (
          <div className="claudian-external-context-empty">{emptyLabel}</div>
        ) : (
          <div className="claudian-external-context-list">
            {entries.map((entry) => (
              <div className="claudian-external-context-item" key={entry.path}>
                <ObsidianIcon className="claudian-external-context-icon" icon="folder" />
                <span className="claudian-external-context-text">
                  <span className="claudian-external-context-name" title={entry.path}>{entry.name}</span>
                  <span className="claudian-external-context-path" title={entry.path}>{entry.parentPath}</span>
                </span>
                <span className={`claudian-external-context-state${entry.persistent ? ' is-persistent' : ''}`}>
                  {entry.persistent ? acrossSessionsLabel : thisConversationLabel}
                </span>
                <button
                  aria-label={entry.persistent ? sessionOnlyLabel : persistLabel}
                  aria-pressed={entry.persistent}
                  className={`claudian-external-context-lock${entry.persistent ? ' locked' : ''}`}
                  title={entry.persistent ? sessionOnlyLabel : persistLabel}
                  type="button"
                  onClick={() => onTogglePersistence(entry.path)}
                >
                  <ObsidianIcon icon={entry.persistent ? 'lock' : 'unlock'} />
                </button>
                <button
                  aria-label={removeLabel}
                  className="claudian-external-context-remove"
                  title={removeLabel}
                  type="button"
                  onClick={() => onRemove(entry.path)}
                >
                  <ObsidianIcon icon="x" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
