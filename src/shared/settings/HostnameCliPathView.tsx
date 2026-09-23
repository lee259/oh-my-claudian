export interface HostnameCliPathViewProps {
  disabled: boolean;
  name: string;
  placeholder: string;
  validationMessage: string | null;
  value: string;
  onInput: (value: string) => void;
}

export function HostnameCliPathView({
  disabled,
  name,
  placeholder,
  validationMessage,
  value,
  onInput,
}: HostnameCliPathViewProps) {
  return (
    <input
      aria-disabled={disabled}
      aria-invalid={Boolean(validationMessage)}
      aria-label={name}
      className={`claudian-settings-cli-path-input${validationMessage ? ' claudian-input-error' : ''}`}
      disabled={disabled}
      placeholder={placeholder}
      type="text"
      value={value}
      onInput={(event) => onInput(event.currentTarget.value)}
    />
  );
}
