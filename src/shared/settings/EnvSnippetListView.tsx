import { IconButton } from '../ui/IconButton';

export interface EnvSnippetListItem {
  id: string;
  name: string;
  description: string;
}

export interface EnvSnippetListLabels {
  name: string;
  add: string;
  empty: string;
  insert: string;
  edit: string;
  delete: string;
}

export interface EnvSnippetListViewProps {
  items: readonly EnvSnippetListItem[];
  labels: EnvSnippetListLabels;
  onAdd: () => void;
  onInsert: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function EnvSnippetListView({
  items,
  labels,
  onAdd,
  onInsert,
  onEdit,
  onDelete,
}: EnvSnippetListViewProps) {
  return (
    <>
      <div className="claudian-snippet-header">
        <span className="claudian-snippet-label">{labels.name}</span>
        <IconButton
          className="claudian-settings-action-btn"
          icon="plus"
          label={labels.add}
          onClick={onAdd}
        />
      </div>

      {items.length === 0 ? (
        <div className="claudian-snippet-empty">{labels.empty}</div>
      ) : (
        <ul className="claudian-snippet-list">
          {items.map(item => (
            <li className="claudian-snippet-item" key={item.id}>
              <div className="claudian-snippet-info">
                <div className="claudian-snippet-name">{item.name}</div>
                {item.description ? (
                  <div className="claudian-snippet-description">{item.description}</div>
                ) : null}
              </div>
              <div className="claudian-snippet-actions">
                <IconButton
                  className="claudian-settings-action-btn"
                  icon="clipboard-paste"
                  label={`${labels.insert}: ${item.name}`}
                  onClick={() => onInsert(item.id)}
                />
                <IconButton
                  className="claudian-settings-action-btn"
                  icon="pencil"
                  label={`${labels.edit}: ${item.name}`}
                  onClick={() => onEdit(item.id)}
                />
                <IconButton
                  className="claudian-settings-action-btn claudian-settings-delete-btn"
                  icon="trash-2"
                  label={`${labels.delete}: ${item.name}`}
                  onClick={() => onDelete(item.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
