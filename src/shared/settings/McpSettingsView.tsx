import { setIcon } from 'obsidian';

export interface McpSettingsViewServer {
  name: string;
  type: string;
  enabled: boolean;
  contextSaving: boolean;
  contextSavingTitle: string;
  preview: string;
  description?: string;
}

export interface McpSettingsViewProps {
  menuId: string;
  menuOpen: boolean;
  servers: readonly McpSettingsViewServer[];
  onToggleMenu: () => void;
  onAddStdio: () => void;
  onAddHttp: () => void;
  onImport: () => void;
  onTest: (name: string) => void;
  onToggleServer: (name: string) => void;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}

export function McpSettingsView({
  menuId,
  menuOpen,
  servers,
  onToggleMenu,
  onAddStdio,
  onAddHttp,
  onImport,
  onTest,
  onToggleServer,
  onEdit,
  onDelete,
}: McpSettingsViewProps) {
  return (
    <div className="claudian-mcp-settings">
      <div className="claudian-mcp-header">
        <span className="claudian-mcp-label">MCP Servers</span>
        <div className="claudian-mcp-add-container">
          <button
            type="button"
            className="claudian-settings-action-btn"
            aria-label="Add"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={onToggleMenu}
          >
            <span aria-hidden="true" ref={element => {
              if (element) setIcon(element, 'plus');
            }} />
          </button>
          <div
            className={`claudian-mcp-add-dropdown${menuOpen ? ' is-visible' : ''}`}
            id={menuId}
            role="menu"
            hidden={!menuOpen}
          >
            <MenuOption icon="terminal" label="stdio (local command)" onClick={onAddStdio} />
            <MenuOption icon="globe" label="http / sse (remote)" onClick={onAddHttp} />
            <MenuOption icon="clipboard-paste" label="Paste configuration" onClick={onImport} />
          </div>
        </div>
      </div>
      {servers.length === 0 ? (
        <div className="claudian-mcp-empty">
          No mcp servers configured. Click "add" to add one.
        </div>
      ) : (
        <div className="claudian-mcp-list">
          {servers.map(server => (
            <div
              className={`claudian-mcp-item${server.enabled ? '' : ' claudian-mcp-item-disabled'}`}
              key={server.name}
            >
              <div
                className={`claudian-mcp-status claudian-mcp-status-${server.enabled ? 'enabled' : 'disabled'}`}
                aria-label={server.enabled ? 'Enabled' : 'Disabled'}
              />
              <div className="claudian-mcp-info">
                <div className="claudian-mcp-name-row">
                  <span className="claudian-mcp-name">{server.name}</span>
                  <span className="claudian-mcp-type-badge">{server.type}</span>
                  {server.contextSaving && (
                    <span
                      className="claudian-mcp-context-saving-badge"
                      title={server.contextSavingTitle}
                    >
                      @
                    </span>
                  )}
                </div>
                <div className="claudian-mcp-preview">
                  {server.description || server.preview}
                </div>
              </div>
              <div className="claudian-mcp-actions">
                <IconButton
                  icon="zap"
                  label="Verify (show tools)"
                  onClick={() => onTest(server.name)}
                />
                <IconButton
                  icon={server.enabled ? 'toggle-right' : 'toggle-left'}
                  label={server.enabled ? 'Disable' : 'Enable'}
                  onClick={() => onToggleServer(server.name)}
                />
                <IconButton
                  icon="pencil"
                  label="Edit"
                  onClick={() => onEdit(server.name)}
                />
                <IconButton
                  icon="trash-2"
                  label="Delete"
                  className="claudian-mcp-delete-btn"
                  onClick={() => onDelete(server.name)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MenuOptionProps {
  icon: string;
  label: string;
  onClick: () => void;
}

function MenuOption({ icon, label, onClick }: MenuOptionProps) {
  return (
    <button type="button" className="claudian-mcp-add-option" role="menuitem" onClick={onClick}>
      <span className="claudian-mcp-add-option-icon" aria-hidden="true" ref={element => {
        if (element) setIcon(element, icon);
      }} />
      <span>{label}</span>
    </button>
  );
}

interface IconButtonProps {
  icon: string;
  label: string;
  className?: string;
  onClick: () => void;
}

function IconButton({ icon, label, className, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`claudian-mcp-action-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true" ref={element => {
        if (element) setIcon(element, icon);
      }} />
    </button>
  );
}
