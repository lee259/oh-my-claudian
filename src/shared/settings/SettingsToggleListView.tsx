import { useState } from 'preact/hooks';

export interface SettingsToggleListItem {
  id: string;
  name: string;
  description: string;
  value: boolean;
}

export interface SettingsToggleListViewProps {
  items: readonly SettingsToggleListItem[];
  onChange: (id: string, value: boolean) => Promise<void> | void;
}

function getDescriptionId(id: string): string {
  return `claudian-settings-toggle-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-description`;
}

export function SettingsToggleListView({
  items,
  onChange,
}: SettingsToggleListViewProps) {
  const [values, setValues] = useState<Record<string, boolean>>(
    () => Object.fromEntries(items.map(item => [item.id, item.value])),
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const handleChange = async (item: SettingsToggleListItem, nextValue: boolean): Promise<void> => {
    setValues(previous => ({ ...previous, [item.id]: nextValue }));
    setPendingIds(previous => new Set(previous).add(item.id));

    try {
      await onChange(item.id, nextValue);
    } catch {
      setValues(previous => ({ ...previous, [item.id]: item.value }));
    } finally {
      setPendingIds(previous => {
        const next = new Set(previous);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <div className="claudian-settings-toggle-list">
      {items.map(item => {
        const descriptionId = getDescriptionId(item.id);
        const value = values[item.id] ?? item.value;
        const pending = pendingIds.has(item.id);
        return (
          <div className="setting-item" key={item.id}>
            <div className="setting-item-info">
              <div className="setting-item-name">{item.name}</div>
              <div className="setting-item-description" id={descriptionId}>
                {item.description}
              </div>
            </div>
            <div className="setting-item-control">
              <div className={`checkbox-container${value ? ' is-enabled' : ''}`}>
                <input
                  aria-describedby={descriptionId}
                  aria-label={item.name}
                  checked={value}
                  disabled={pending}
                  type="checkbox"
                  onChange={(event) => {
                    void handleChange(item, event.currentTarget.checked);
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
