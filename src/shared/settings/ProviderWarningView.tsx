export interface ProviderWarningViewProps {
  ariaLive?: 'polite' | 'assertive';
  message: string;
  role?: 'status' | 'alert';
  visible: boolean;
}

export function ProviderWarningView({
  ariaLive,
  message,
  role,
  visible,
}: ProviderWarningViewProps) {
  const classes = [
    'claudian-provider-model-warning',
    'claudian-setting-validation',
    'claudian-setting-validation-warning',
    ...(visible ? [] : ['claudian-hidden']),
  ].join(' ');

  return (
    <div
      aria-live={ariaLive}
      className={classes}
      hidden={!visible}
      role={role}
    >
      {message}
    </div>
  );
}
