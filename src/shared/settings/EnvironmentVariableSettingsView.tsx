import type { EnvironmentScope } from '../../core/types/settings';
import { getEnvironmentReviewKeysForScope } from '../../core/providers/providerEnvironment';
import { useState } from 'preact/hooks';

export interface EnvironmentVariableSettingsViewProps {
  scope: EnvironmentScope;
  name: string;
  description: string;
  placeholder: string;
  initialValue: string;
  onApply: (value: string) => Promise<void> | void;
}

function getReviewWarningId(scope: EnvironmentScope): string {
  return `claudian-environment-review-${scope.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function EnvironmentVariableSettingsView({
  scope,
  name,
  description,
  placeholder,
  initialValue,
  onApply,
}: EnvironmentVariableSettingsViewProps) {
  const [value, setValue] = useState(initialValue);
  const [reviewKeys, setReviewKeys] = useState(
    getEnvironmentReviewKeysForScope(initialValue, scope),
  );
  const warningId = getReviewWarningId(scope);

  return (
    <>
      <div
        className="claudian-env-review-warning claudian-setting-validation claudian-setting-validation-warning"
        hidden={reviewKeys.length === 0}
        id={warningId}
        role="status"
        aria-live="polite"
      >
        Review environment ownership for: {reviewKeys.join(', ')}
      </div>
      <div className="setting-item claudian-environment-setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{name}</div>
          <div className="setting-item-description">{description}</div>
        </div>
        <div className="setting-item-control">
          <textarea
            aria-describedby={warningId}
            aria-label={name}
            className="claudian-settings-env-textarea"
            cols={50}
            data-env-scope={scope}
            placeholder={placeholder}
            rows={6}
            value={value}
            onInput={(event) => {
              const nextValue = event.currentTarget.value;
              setValue(nextValue);
              setReviewKeys(getEnvironmentReviewKeysForScope(nextValue, scope));
            }}
            onBlur={() => {
              void onApply(value);
            }}
          />
        </div>
      </div>
    </>
  );
}
