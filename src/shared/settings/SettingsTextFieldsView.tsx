import { useEffect, useRef, useState } from 'preact/hooks';

export interface SettingsTextFieldItem {
  id: string;
  name: string;
  description: string;
  value: string;
  placeholder: string;
  kind?: 'text' | 'textarea';
  rows?: number;
  cols?: number;
  className?: string;
}

export interface SettingsTextFieldsViewProps {
  items: readonly SettingsTextFieldItem[];
  onChange: (id: string, value: string) => Promise<void> | void;
  onBlur?: (id: string) => Promise<void> | void;
}

function getDescriptionId(id: string): string {
  return `claudian-settings-text-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-description`;
}

export function SettingsTextFieldsView({ items, onChange, onBlur }: SettingsTextFieldsViewProps) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map(item => [item.id, item.value])),
  );
  const valuesRef = useRef(values);
  const timersRef = useRef(new Map<string, number>());
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);

  valuesRef.current = values;
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const clearTimer = (id: string): void => {
    const timer = timersRef.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timersRef.current.delete(id);
  };

  const saveValue = async (id: string): Promise<void> => {
    clearTimer(id);
    await onChangeRef.current(id, valuesRef.current[id] ?? '');
  };

  useEffect(() => () => {
    for (const [id, timer] of timersRef.current) {
      window.clearTimeout(timer);
      void onChangeRef.current(id, valuesRef.current[id] ?? '');
    }
    timersRef.current.clear();
  }, []);

  return (
    <div className="claudian-settings-text-fields">
      {items.map(item => {
        const descriptionId = getDescriptionId(item.id);
        const commonProps = {
          'aria-describedby': descriptionId,
          'aria-label': item.name,
          className: item.className,
          placeholder: item.placeholder,
          value: values[item.id] ?? item.value,
          onInput: (event: Event) => {
            const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
            const nextValue = target.value;
            valuesRef.current = { ...valuesRef.current, [item.id]: nextValue };
            setValues(valuesRef.current);
            clearTimer(item.id);
            timersRef.current.set(item.id, window.setTimeout(() => {
              void saveValue(item.id);
            }, 150));
          },
          onBlur: async () => {
            await saveValue(item.id);
            await onBlurRef.current?.(item.id);
          },
        };

        return (
          <div className="setting-item" key={item.id}>
            <div className="setting-item-info">
              <div className="setting-item-name">{item.name}</div>
              <div className="setting-item-description" id={descriptionId}>
                {item.description}
              </div>
            </div>
            <div className="setting-item-control">
              {item.kind === 'textarea' ? (
                <textarea
                  {...commonProps}
                  cols={item.cols ?? 30}
                  rows={item.rows ?? 4}
                />
              ) : (
                <input {...commonProps} type="text" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
