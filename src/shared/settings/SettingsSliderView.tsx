import { useRef, useState } from 'preact/hooks';

import {
  SettingsSaveFeedback,
  type SettingsSaveLabels,
  useSettingsSaveState,
} from './SettingsSaveFeedback';

export interface SettingsSliderViewProps {
  name: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  saveLabels: SettingsSaveLabels;
  onChange: (value: number) => Promise<void> | void;
}

export function SettingsSliderView({
  name,
  description,
  min,
  max,
  step,
  value: initialValue,
  saveLabels,
  onChange,
}: SettingsSliderViewProps) {
  const [value, setValue] = useState(initialValue);
  const committedValueRef = useRef(initialValue);
  const changeVersionRef = useRef(0);
  const { states, save } = useSettingsSaveState();
  const descriptionId = 'claudian-settings-slider-description';
  const saveState = states.value;
  const progress = max > min
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0;

  return (
    <div className="setting-item">
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description" id={descriptionId}>{description}</div>
        <SettingsSaveFeedback labels={saveLabels} state={saveState} />
      </div>
      <div className="setting-item-control claudian-settings-slider-control">
        <input
          aria-describedby={descriptionId}
          aria-label={name}
          className="slider"
          max={max}
          min={min}
          step={step}
          style={`--claudian-settings-slider-progress: ${progress}%;`}
          type="range"
          value={value}
          onInput={(event) => {
            const nextValue = Number(event.currentTarget.value);
            const changeVersion = ++changeVersionRef.current;
            setValue(nextValue);
            void save('value', () => onChange(nextValue)).then((saved) => {
              if (changeVersion !== changeVersionRef.current) return;
              if (saved) {
                committedValueRef.current = nextValue;
              } else {
                setValue(committedValueRef.current);
              }
            });
          }}
        />
        <span className="claudian-settings-slider-value">{value}</span>
      </div>
    </div>
  );
}
