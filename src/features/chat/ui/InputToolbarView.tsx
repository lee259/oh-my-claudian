import { ObsidianIcon } from '../../../shared/ui/ObsidianIcon';

export type InputToolbarSlot = 'context-external' | 'context-mcp' | 'config' | 'status' | 'execution' | 'send';

export interface InputToolbarViewProps {
  addContextLabel: string;
  menuId: string;
  menuOpen: boolean;
  mcpLabel: string;
  onAddContext: () => void;
  onMenuToggle: () => void;
  onSlot: (slot: InputToolbarSlot, element: HTMLElement | null) => void;
}

function Slot({
  name,
  onSlot,
}: {
  name: InputToolbarSlot;
  onSlot: InputToolbarViewProps['onSlot'];
}) {
  return <div className="claudian-input-toolbar-slot" ref={(element) => onSlot(name, element)} />;
}

export function InputToolbarView({
  addContextLabel,
  menuId,
  menuOpen,
  mcpLabel,
  onAddContext,
  onMenuToggle,
  onSlot,
}: InputToolbarViewProps) {
  return (
    <>
      <div className={`claudian-context-actions${menuOpen ? ' is-open' : ''}`}>
        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-haspopup="true"
          aria-label={addContextLabel}
          className={`claudian-context-actions-trigger${menuOpen ? ' is-open' : ''}`}
          type="button"
          onClick={onMenuToggle}
        >
          <ObsidianIcon icon="plus" />
        </button>
        <div
          aria-label={addContextLabel}
          className="claudian-context-actions-menu"
          hidden={!menuOpen}
          id={menuId}
          role="group"
          tabIndex={-1}
        >
          <button
            aria-label={addContextLabel}
            className="claudian-context-action-button claudian-context-action-add-context"
            type="button"
            onClick={onAddContext}
          >
            <ObsidianIcon className="claudian-context-action-icon" icon="file-plus" />
            <span>{addContextLabel}</span>
          </button>
          <div className="claudian-context-action-section claudian-context-action-section--external">
            <Slot name="context-external" onSlot={onSlot} />
          </div>
          <div className="claudian-context-action-section">
            <span className="claudian-context-action-label">{mcpLabel}</span>
            <Slot name="context-mcp" onSlot={onSlot} />
          </div>
        </div>
      </div>
      <div className="claudian-input-toolbar-group claudian-input-toolbar-config-group">
        <Slot name="config" onSlot={onSlot} />
      </div>
      <div className="claudian-input-toolbar-group claudian-input-toolbar-status-group">
        <Slot name="status" onSlot={onSlot} />
      </div>
      <div className="claudian-input-toolbar-group claudian-input-toolbar-execution-group">
        <Slot name="execution" onSlot={onSlot} />
      </div>
      <Slot name="send" onSlot={onSlot} />
    </>
  );
}
