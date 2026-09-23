import { useEffect, useState } from 'preact/hooks';

import {
  SettingsSaveFeedback,
  type SettingsSaveLabels,
  useSettingsSaveState,
} from './SettingsSaveFeedback';

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
  saveLabels: SettingsSaveLabels;
  onChange: (id: string, value: string) => Promise<void> | void;
}

function getDescriptionId(id: string): string {
  return `claudian-settings-select-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-description`;
}

export function SettingsSelectListView({ items, onChange, saveLabels }: SettingsSelectListViewProps) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map(item => [item.id, item.value])),
  );
  const { states, save } = useSettingsSaveState();

  useEffect(() => {
    setValues(Object.fromEntries(items.map(item => [item.id, item.value])));
  }, [items]);

  const handleChange = async (item: SettingsSelectListItem, nextValue: string): Promise<void> => {
    setValues(previous => ({ ...previous, [item.id]: nextValue }));
    const saved = await save(item.id, () => onChange(item.id, nextValue));
    if (!saved) {
      setValues(previous => ({ ...previous, [item.id]: item.value }));
    }
  };

  return (
    <div className="claudian-settings-select-list">
      {items.map(item => {
        const descriptionId = getDescriptionId(item.id);
        const value = values[item.id] ?? item.value;
        const saveState = states[item.id];
        const pending = saveState?.status === 'saving';
        return (
          <div className="setting-item" key={item.id}>
            <div className="setting-item-info">
              <div className="setting-item-name">{item.name}</div>
              <div className="setting-item-description" id={descriptionId}>
                {item.description}
              </div>
              <SettingsSaveFeedback labels={saveLabels} state={saveState} />
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
