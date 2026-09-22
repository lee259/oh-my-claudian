import { useEffect, useRef, useState } from 'preact/hooks';

export interface NavigationMappingsViewProps {
  name: string;
  description: string;
  placeholder: string;
  initialValue: string;
  validate: (value: string) => string | null;
  onSave: (value: string) => Promise<string>;
  onInvalid: (error: string) => void;
}

export function NavigationMappingsView({
  name,
  description,
  placeholder,
  initialValue,
  validate,
  onSave,
  onInvalid,
}: NavigationMappingsViewProps) {
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const savedValueRef = useRef(initialValue);
  const saveTimeoutRef = useRef<number | null>(null);

  const clearSaveTimeout = (): void => {
    if (saveTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  };

  const commitValue = async (nextValue: string, showError: boolean): Promise<void> => {
    clearSaveTimeout();
    const error = validate(nextValue);
    if (error) {
      if (showError) {
        onInvalid(error);
        valueRef.current = savedValueRef.current;
        setValue(savedValueRef.current);
      }
      return;
    }

    const savedValue = await onSave(nextValue);
    valueRef.current = savedValue;
    savedValueRef.current = savedValue;
    setValue(savedValue);
  };

  useEffect(() => () => clearSaveTimeout(), []);

  return (
    <div className="setting-item claudian-navigation-mappings-setting-item">
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description">{description}</div>
      </div>
      <div className="setting-item-control">
        <textarea
          aria-label={name}
          className="claudian-settings-nav-mappings-textarea"
          cols={30}
          placeholder={placeholder}
          rows={3}
          value={value}
          onInput={(event) => {
            const nextValue = event.currentTarget.value;
            valueRef.current = nextValue;
            setValue(nextValue);
            clearSaveTimeout();
            saveTimeoutRef.current = window.setTimeout(() => {
              void commitValue(valueRef.current, false);
            }, 500);
          }}
          onBlur={() => {
            void commitValue(valueRef.current, true);
          }}
        />
      </div>
    </div>
  );
}
