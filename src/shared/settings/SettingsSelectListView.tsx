import { useEffect, useState } from 'preact/hooks';

export interface SettingsSelectOption {
  value: string;
  label: string;
}

export interface SettingsSelectListItem {
  id: string;
  name: string;
  description: string;
  value: string;
  options: readonly SettingsSelectOption[];
}

export interface SettingsSelectListViewProps {
  items: readonly SettingsSelectListItem[];
  onChange: (id: string, value: string) => Promise<void> | void;
}

function getDescriptionId(id: string): string {
  return `claudian-settings-select-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-description`;
}

export function SettingsSelectListView({ items, onChange }: SettingsSelectListViewProps) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map(item => [item.id, item.value])),
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setValues(Object.fromEntries(items.map(item => [item.id, item.value])));
  }, [items]);

  const handleChange = async (item: SettingsSelectListItem, nextValue: string): Promise<void> => {
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
    <div className="claudian-settings-select-list">
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
              <select
                aria-describedby={descriptionId}
                aria-label={item.name}
                className="dropdown"
                disabled={pending}
                value={value}
                onChange={(event) => {
                  void handleChange(item, event.currentTarget.value);
                }}
              >
                {item.options.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
