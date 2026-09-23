import { useState } from 'preact/hooks';

import {
  SettingsSaveFeedback,
  type SettingsSaveLabels,
  useSettingsSaveState,
} from './SettingsSaveFeedback';

export interface SettingsToggleListItem {
  id: string;
  name: string;
  description: string;
  value: boolean;
}

export interface SettingsToggleListViewProps {
  items: readonly SettingsToggleListItem[];
  saveLabels: SettingsSaveLabels;
  onChange: (id: string, value: boolean) => Promise<void> | void;
}

function getDescriptionId(id: string): string {
  return `claudian-settings-toggle-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-description`;
}

export function SettingsToggleListView({
  items,
  saveLabels,
  onChange,
}: SettingsToggleListViewProps) {
  const [values, setValues] = useState<Record<string, boolean>>(
    () => Object.fromEntries(items.map(item => [item.id, item.value])),
  );
  const { states, save } = useSettingsSaveState();

  const handleChange = async (item: SettingsToggleListItem, nextValue: boolean): Promise<void> => {
    setValues(previous => ({ ...previous, [item.id]: nextValue }));
    const saved = await save(item.id, () => onChange(item.id, nextValue));
    if (!saved) {
      setValues(previous => ({ ...previous, [item.id]: item.value }));
    }
  };

  return (
    <div className="claudian-settings-toggle-list">
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
              <div
                className={`checkbox-container${value ? ' is-enabled' : ''}`}
                onClick={(event) => {
                  const input = event.currentTarget.querySelector('input');
                  if (input && event.target !== input && !input.disabled) {
                    void handleChange(item, !input.checked);
                  }
                }}
              >
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
