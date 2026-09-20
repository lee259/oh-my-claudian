import { setIcon } from 'obsidian';
import { useState } from 'preact/hooks';

import { t } from '../../../i18n/i18n';

export interface HistorySearchViewProps {
  initialQuery: string;
  onQueryChange: (query: string) => void;
}

/** Small Preact-owned search shell around the legacy history list renderer. */
export function HistorySearchView({
  initialQuery,
  onQueryChange,
}: HistorySearchViewProps) {
  const [query, setQuery] = useState(initialQuery);

  return (
    <div className="claudian-home-history-search">
      <span
        className="claudian-home-history-search-icon"
        aria-hidden="true"
        ref={(element) => {
          if (element) setIcon(element, 'search');
        }}
      />
      <input
        className="claudian-home-history-search-input"
        type="search"
        placeholder={t('chat.history.searchRecent')}
        aria-label={t('chat.history.searchAria')}
        value={query}
        onInput={(event) => {
          const nextQuery = (event.currentTarget as HTMLInputElement).value;
          setQuery(nextQuery);
          onQueryChange(nextQuery);
        }}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
