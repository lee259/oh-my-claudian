import { useLayoutEffect, useRef } from 'preact/hooks';

import type { ProviderIconSvg, ProviderId } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import { createProviderIconSvg } from '@/shared/icons';
import { ObsidianIcon } from '@/shared/ui/ObsidianIcon';

export interface ProviderSettingsEntry {
  id: ProviderId;
  name: string;
  enabled: boolean;
  icon?: ProviderIconSvg | null;
}

export interface ProviderSettingsBrowserProps {
  providers: readonly ProviderSettingsEntry[];
  activeProviderId: ProviderId | null;
  query: string;
  onQueryChange: (query: string) => void;
  enabledOnly: boolean;
  onEnabledOnlyChange: (enabledOnly: boolean) => void;
  onSelect: (id: ProviderId) => void;
  onBack: () => void;
}

/** Navigation only; the host retains provider-owned settings and their drafts. */
export function ProviderSettingsBrowser({
  providers, activeProviderId, query, onQueryChange, enabledOnly, onEnabledOnlyChange, onSelect, onBack,
}: ProviderSettingsBrowserProps) {
  const previousProviderId = useRef(activeProviderId);
  const rows = useRef<Record<string, HTMLButtonElement | null>>({});
  const backButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (activeProviderId !== previousProviderId.current) {
      if (activeProviderId) {
        backButton.current?.focus({ preventScroll: true });
      } else if (previousProviderId.current) {
        const target = rows.current[previousProviderId.current] ?? searchInput.current;
        target?.focus({ preventScroll: true });
      }
    }
    previousProviderId.current = activeProviderId;
  }, [activeProviderId]);

  const activeProvider = providers.find(provider => provider.id === activeProviderId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = providers.filter(provider => (
    (!enabledOnly || provider.enabled)
    && `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(normalizedQuery)
  ));
  return (
    <div className="claudian-provider-browser">
      <div className="claudian-provider-browser-list" hidden={!!activeProvider}>
        <div className="claudian-provider-browser-toolbar">
          <div className="claudian-provider-browser-search-field">
            <ObsidianIcon icon="search" />
            <input
              type="search"
              className="claudian-provider-browser-search"
              aria-label={t('settings.providerSettings.search')}
              placeholder={t('settings.providerSettings.search')}
              value={query}
              ref={searchInput}
              onInput={event => onQueryChange(event.currentTarget.value)}
            />
          </div>
          <label className="claudian-provider-browser-filter">
            <input
              type="checkbox"
              checked={enabledOnly}
              onChange={event => onEnabledOnlyChange(event.currentTarget.checked)}
            />
            {t('settings.providerSettings.enabledOnly')}
          </label>
        </div>
        <ul aria-label={t('settings.tabs.providers')}>
          {matches.map(provider => (
            <li key={provider.id}>
              <button
                className="claudian-provider-browser-row claudian-provider-browser-row--navigation"
                type="button"
                data-provider-id={provider.id}
                ref={element => { rows.current[provider.id] = element; }}
                onClick={() => onSelect(provider.id)}
              >
                <span
                  className="claudian-provider-browser-icon"
                  aria-hidden="true"
                  ref={element => {
                    if (!element) return;
                    element.replaceChildren();
                    if (provider.icon) {
                      createProviderIconSvg(provider.icon, {
                        parent: element, dataProvider: provider.id, width: 22, height: 22,
                      });
                    }
                  }}
                />
                <span className="claudian-provider-browser-name">{provider.name}</span>
                <span className="claudian-provider-browser-status" data-enabled={provider.enabled}>
                  <span className="claudian-provider-browser-status-dot" aria-hidden="true" />
                  {t(provider.enabled ? 'common.enabled' : 'common.disabled')}
                </span>
                <ObsidianIcon icon="chevron-right" />
              </button>
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p role="status">{t('settings.providerSettings.noMatches')}</p>}
      </div>
      {activeProvider && (
        <div className="claudian-provider-browser-detail-header">
          <button
            type="button"
            className="claudian-provider-browser-back"
            ref={backButton}
            onClick={onBack}
          >
            <ObsidianIcon icon="chevron-left" />
            {t('settings.providerSettings.allProviders')}
          </button>
          <h3 id={`claudian-settings-provider-title-${activeProvider.id}`}>{activeProvider.name}</h3>
        </div>
      )}
    </div>
  );
}
