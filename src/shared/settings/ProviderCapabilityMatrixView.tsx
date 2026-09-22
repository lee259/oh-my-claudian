export interface ProviderCapabilityMatrixRow {
  key: string;
  label: string;
}

export interface ProviderCapabilityMatrixProvider {
  label: string;
  supportedKeys: readonly string[];
}

export interface ProviderCapabilityMatrixViewProps {
  providerLabel: string;
  supportedLabel: string;
  unsupportedLabel: string;
  rows: readonly ProviderCapabilityMatrixRow[];
  providers: readonly ProviderCapabilityMatrixProvider[];
}

export function ProviderCapabilityMatrixView({
  providerLabel,
  supportedLabel,
  unsupportedLabel,
  rows,
  providers,
}: ProviderCapabilityMatrixViewProps) {
  return (
    <div className="claudian-provider-capability-matrix">
      <table>
        <thead>
          <tr>
            <th scope="col">{providerLabel}</th>
            {rows.map(row => <th key={row.key} scope="col">{row.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {providers.map(provider => (
            <tr key={provider.label}>
              <th scope="row">{provider.label}</th>
              {rows.map(row => {
                const supported = provider.supportedKeys.includes(row.key);
                return (
                  <td
                    className={supported
                      ? 'claudian-capability-supported'
                      : 'claudian-capability-unsupported'}
                    key={row.key}
                  >
                    {supported ? supportedLabel : unsupportedLabel}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
