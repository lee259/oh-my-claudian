import { useState } from 'preact/hooks';

export interface SettingsSliderViewProps {
  name: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => Promise<void> | void;
}

export function SettingsSliderView({
  name,
  description,
  min,
  max,
  step,
  value: initialValue,
  onChange,
}: SettingsSliderViewProps) {
  const [value, setValue] = useState(initialValue);
  const descriptionId = 'claudian-settings-slider-description';

  return (
    <div className="setting-item">
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description" id={descriptionId}>{description}</div>
      </div>
      <div className="setting-item-control claudian-settings-slider-control">
        <input
          aria-describedby={descriptionId}
          aria-label={name}
          className="slider"
          max={max}
          min={min}
          step={step}
          type="range"
          value={value}
          onInput={(event) => {
            const nextValue = Number(event.currentTarget.value);
            setValue(nextValue);
            void onChange(nextValue);
          }}
        />
        <span className="claudian-settings-slider-value">{value}</span>
      </div>
    </div>
  );
}
