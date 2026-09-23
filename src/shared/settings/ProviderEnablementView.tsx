export interface ProviderEnablementViewProps {
  disabled: boolean;
  name: string;
  value: boolean;
  onChange: (enabled: boolean) => void;
}

export function ProviderEnablementView({
  disabled,
  name,
  value,
  onChange,
}: ProviderEnablementViewProps) {
  return (
    <div
      className={`checkbox-container${value ? ' is-enabled' : ''}`}
      onClick={(event) => {
        const input = event.currentTarget.querySelector('input');
        if (input && event.target !== input && !input.disabled) {
          onChange(!input.checked);
        }
      }}
    >
      <input
        aria-label={name}
        aria-disabled={disabled}
        checked={value}
        disabled={disabled}
        role="switch"
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </div>
  );
}
