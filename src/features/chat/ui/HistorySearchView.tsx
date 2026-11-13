import { setIcon } from 'obsidian';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { t } from '../../../i18n/i18n';

export interface HistorySearchViewProps {
  initialQuery: string;
  focusReturnEl?: HTMLElement | null;
  onQueryChange: (query: string) => void;
}

/** Small Preact-owned search shell around the legacy history list renderer. */
export function HistorySearchView({
  initialQuery,
  focusReturnEl,
  onQueryChange,
}: HistorySearchViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => () => {
    const input = inputRef.current;
    if (input && input.ownerDocument.activeElement === input && focusReturnEl?.isConnected
      && focusReturnEl !== input.ownerDocument.body) {
      focusReturnEl.focus({ preventScroll: true });
    }
  }, [focusReturnEl]);

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
        ref={inputRef}
        className="claudian-home-history-search-input"
        type="search"
        placeholder={t('chat.history.searchRecent')}
        aria-label={t('chat.history.searchAria')}
        value={query}
        onInput={(event) => {
          const nextQuery = event.currentTarget.value;
          setQuery(nextQuery);
          onQueryChange(nextQuery);
        }}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
