import { useEffect, useRef, useState } from 'preact/hooks';

import type {
  ProviderIconSvg,
  ProviderId,
  ProviderReasoningOption,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import type { StoredChatModelSelection } from '../../../core/types/settings';
import { ObsidianIcon } from '../../../shared/ui/ObsidianIcon';

export interface ModelSelectorViewProps {
  id: string;
  models: ProviderUIOption[];
  currentModel: string;
  currentProviderId?: ProviderId;
  favoriteModels?: StoredChatModelSelection[];
  onFavoriteToggle?: (model: ProviderUIOption) => void;
  displayModelLabel: string;
  providerIcon?: ProviderIconSvg;
  modelTitle: string;
  reasoningOptions: ProviderReasoningOption[];
  reasoningValue: string;
  reasoningDefaultValue: string;
  reasoningLabel: string;
  serviceTier: ProviderServiceTierToggleConfig | null;
  serviceTierActive: boolean;
  onModelChange: (model: ProviderUIOption) => void;
  onReasoningChange: (value: string) => void;
  onServiceTierToggle: () => void;
}

function ProviderIcon({ icon }: { icon: ProviderIconSvg }) {
  if (icon.kind === 'composite') {
    return (
      <svg aria-hidden="true" className="claudian-provider-icon claudian-model-provider-icon" viewBox={icon.viewBox} fill="none">
        {icon.children.map((child, index) => child.tag === 'path'
          ? <path key={index} {...child.attributes} />
          : <g key={index} {...child.attributes}>
            {child.children.map((nestedChild, nestedIndex) => (
              <path key={nestedIndex} {...nestedChild.attributes} />
            ))}
          </g>)}
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="claudian-provider-icon claudian-model-provider-icon" viewBox={icon.viewBox} fill="none">
      <path d={icon.path} fill={icon.fill ?? 'currentColor'} />
    </svg>
  );
}

export function ModelSelectorView({
  id,
  models,
  currentModel,
  currentProviderId = models.find(model => model.value === currentModel)?.providerId ?? '',
  favoriteModels = [],
  onFavoriteToggle,
  displayModelLabel,
  providerIcon,
  modelTitle,
  reasoningOptions,
  reasoningValue,
  reasoningDefaultValue,
  reasoningLabel,
  serviceTier,
  serviceTierActive,
  onModelChange,
  onReasoningChange,
  onServiceTierToggle,
}: ModelSelectorViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const openFromKeyboardRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>(currentProviderId);
  const [query, setQuery] = useState('');
  const [reasoningPreviewIndex, setReasoningPreviewIndex] = useState<number | null>(null);
  const providers = Array.from(new Map([...models].reverse().map(model => {
    const providerId = model.providerId ?? currentProviderId;
    return [providerId, { id: providerId, label: model.group ?? providerId, icon: model.providerIcon ?? providerIcon }] as const;
  })).values());
  const activeFilter = providers.some(provider => provider.id === filter) || filter === 'favorites'
    ? filter
    : 'all';
  const favoriteKeys = new Set(favoriteModels.map(favorite => JSON.stringify([favorite.providerId, favorite.model])));
  const isFavorite = (model: ProviderUIOption): boolean => favoriteKeys.has(
    JSON.stringify([model.providerId ?? currentProviderId, model.value]),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleModels = [...models].reverse().filter(model => (
    (activeFilter === 'all'
      || (activeFilter === 'favorites' ? isFavorite(model) : (model.providerId ?? currentProviderId) === activeFilter))
    && (!normalizedQuery || [model.label, model.value, model.group ?? ''].some(value => value.toLocaleLowerCase().includes(normalizedQuery)))
  ));
  const selectedModelIndex = visibleModels.findIndex(model => model.value === currentModel
    && (model.providerId ?? currentProviderId) === currentProviderId);
  const resetBrowsing = (): void => {
    setFilter(currentProviderId || 'all');
    setQuery('');
  };
  const committedReasoningIndex = Math.max(0, reasoningOptions.findIndex(option => option.value === reasoningValue));
  const selectedIndex = reasoningPreviewIndex !== null && reasoningOptions[reasoningPreviewIndex]
    ? reasoningPreviewIndex
    : committedReasoningIndex;
  const selectedReasoning = reasoningOptions[selectedIndex];
  const isServiceTierActive = Boolean(serviceTier && serviceTierActive);

  useEffect(() => setReasoningPreviewIndex(null), [currentModel, currentProviderId, reasoningValue]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (openFromKeyboardRef.current) {
      const selectedOption = root?.querySelector<HTMLButtonElement>('.claudian-model-option[aria-pressed="true"]');
      (selectedOption ?? root?.querySelector<HTMLButtonElement>('.claudian-model-option'))?.focus();
      openFromKeyboardRef.current = false;
    } else {
      searchRef.current?.focus();
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeydown, true);
    };
  }, [open]);

  const moveModelFocus = (event: KeyboardEvent): void => {
    const navigationKeys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!navigationKeys.includes(event.key)) return;
    const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.claudian-model-option') ?? []);
    if (options.length === 0) return;
    event.preventDefault();
    const index = options.indexOf(event.currentTarget as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const updateReasoningPreview = (event: Event): void => {
    const index = Number((event.currentTarget as HTMLInputElement).value);
    if (reasoningOptions[index]) setReasoningPreviewIndex(index);
  };

  const renderModelOption = (model: ProviderUIOption, index: number) => {
    const selected = index === selectedModelIndex;
    const favorite = isFavorite(model);
    const showProvider = activeFilter === 'all' || activeFilter === 'favorites';
    return (
      <div
        className={`claudian-model-row${selected ? ' selected' : ''}`}
        key={`${model.providerId ?? currentProviderId}:${model.value}`}
        role="listitem"
      >
        <button
          aria-pressed={selected}
          className={`claudian-model-option${selected ? ' selected' : ''}`}
          data-model-value={model.value}
          tabIndex={selected || (selectedModelIndex === -1 && index === 0) ? 0 : -1}
          title={model.description ? `${model.value} — ${model.description}` : model.value}
          type="button"
          onClick={() => {
            onModelChange(model);
          }}
          onKeyDown={moveModelFocus}
        >
          {showProvider && (model.providerIcon ?? providerIcon) && <ProviderIcon icon={(model.providerIcon ?? providerIcon)!} />}
          <span className="claudian-model-option-label">{model.label}</span>
          {selected && <ObsidianIcon className="claudian-model-option-check" icon="check" />}
        </button>
        {onFavoriteToggle && (
          <button
            aria-label={`${favorite ? 'Remove' : 'Add'} ${model.label} ${favorite ? 'from' : 'to'} favorites`}
            aria-pressed={favorite}
            className={`claudian-model-favorite${favorite ? ' is-favorite' : ''}`}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            type="button"
            onClick={() => {
              if (activeFilter === 'favorites') searchRef.current?.focus();
              onFavoriteToggle(model);
            }}
          >
            <ObsidianIcon icon="star" />
          </button>
        )}
      </div>
    );
  };
  const renderFilter = (value: string, label: string, icon?: ProviderIconSvg, fallbackIcon = 'layers') => (
    <button
      aria-label={label}
      aria-pressed={activeFilter === value}
      className={`claudian-model-provider-filter${activeFilter === value ? ' is-active' : ''}`}
      data-provider-filter={value}
      key={value}
      title={label}
      type="button"
      onClick={() => setFilter(value)}
    >
      {icon ? <ProviderIcon icon={icon} /> : <ObsidianIcon icon={fallbackIcon} />}
    </button>
  );

  const reasoningHasChoice = reasoningOptions.length > 1
    || (reasoningOptions.length === 1 && reasoningOptions[0]?.value !== reasoningDefaultValue);
  const displayReasoning = selectedReasoning?.label ?? (reasoningValue || 'Default');

  return (
    <div
      className={`claudian-model-selector${open ? ' claudian-model-selector--open' : ''}`}
      ref={rootRef}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={[
          `Model: ${displayModelLabel}`,
          reasoningHasChoice ? `${reasoningLabel}: ${displayReasoning}` : null,
          isServiceTierActive ? 'Fast mode on' : null,
        ].filter(Boolean).join(', ')}
        className="claudian-model-btn"
        ref={triggerRef}
        title={modelTitle}
        type="button"
        onClick={() => {
          openFromKeyboardRef.current = false;
          if (!open) resetBrowsing();
          setOpen(value => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openFromKeyboardRef.current = true;
          if (!open) resetBrowsing();
          setOpen(true);
        }}
      >
        {providerIcon && <ProviderIcon icon={providerIcon} />}
        <span className="claudian-model-label">{displayModelLabel}</span>
        <span className="claudian-model-details">
          {reasoningHasChoice && <span className="claudian-model-secondary claudian-thinking-current">{displayReasoning}</span>}
          {isServiceTierActive && <ObsidianIcon className="claudian-model-secondary claudian-service-tier-indicator" icon="zap" />}
        </span>
        <ObsidianIcon className="claudian-model-chevron" icon="chevron-down" />
      </button>

      <div
        aria-label="Model options"
        className="claudian-model-dropdown"
        hidden={!open}
        id={id}
        role="dialog"
        tabIndex={-1}
      >
        <div className="claudian-model-browser">
          <nav aria-label="Filter models by provider" className="claudian-model-provider-rail">
            {renderFilter('favorites', 'Favorite models', undefined, 'star')}
            {renderFilter('all', 'All models')}
            <div className="claudian-model-provider-divider" />
            {providers.map(provider => renderFilter(provider.id, provider.label || 'Current provider', provider.icon))}
          </nav>
          <div className="claudian-model-browser-main">
            <div className="claudian-model-search">
              <ObsidianIcon icon="search" />
              <input
                aria-label="Search models"
                autoComplete="off"
                placeholder="Search models"
                ref={searchRef}
                spellcheck={false}
                type="search"
                value={query}
                onInput={event => setQuery(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  const options = rootRef.current?.querySelectorAll<HTMLButtonElement>('.claudian-model-option');
                  if (!options?.length) return;
                  event.preventDefault();
                  options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
                }}
              />
              {query && (
                <button
                  aria-label="Clear search"
                  className="claudian-model-search-clear"
                  type="button"
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                >
                  <ObsidianIcon icon="x" />
                </button>
              )}
            </div>
            <div className="claudian-model-options">
              {visibleModels.length > 0
                ? <div aria-label="Model" className="claudian-model-list" role="list">{visibleModels.map(renderModelOption)}</div>
                : <div className="claudian-model-empty" role="status">{
                  models.length === 0
                    ? 'No models available. Check provider settings and refresh the model list if discovery failed.'
                    : normalizedQuery
                      ? 'No matching models.'
                      : 'No favorite models available. Use the star beside a model to add it.'
                }</div>}
            </div>
            {selectedModelIndex !== -1 && (reasoningHasChoice || serviceTier) && (
              <section aria-label="Current model settings" className="claudian-model-menu-footer">
                <div className="claudian-model-settings-heading">
                  <span>Current model settings</span>
                  <span className="claudian-model-settings-name" title={displayModelLabel}>{displayModelLabel}</span>
                </div>
                <div className="claudian-model-settings-controls">
                  {reasoningHasChoice && (
                    <section aria-label={reasoningLabel} className="claudian-thinking-selector">
                      <div className="claudian-model-slider-heading">
                        <span className="claudian-model-slider-label">{reasoningLabel}</span>
                        <span className="claudian-model-slider-value">{displayReasoning}</span>
                      </div>
                      <div className="claudian-model-slider-endpoints" aria-hidden="true">
                        <span>Faster</span>
                        <span>Smarter</span>
                      </div>
                      <div className="claudian-model-slider">
                        <div aria-hidden="true" className="claudian-model-slider-track">
                          <span className="claudian-model-slider-fill-start" />
                          {reasoningOptions.slice(1).map((option, index) => (
                            <span
                              className={`claudian-model-slider-segment${index < selectedIndex ? ' is-filled' : ''}`}
                              key={option.value}
                            />
                          ))}
                        </div>
                        <div aria-hidden="true" className="claudian-model-slider-stops">
                          {reasoningOptions.map((option, index) => (
                            <span
                              className={`claudian-model-slider-tick${index <= selectedIndex ? ' is-filled' : ''}${option.value === reasoningDefaultValue ? ' is-recommended' : ''}`}
                              key={option.value}
                            />
                          ))}
                        </div>
                        <input
                          aria-label={reasoningLabel}
                          aria-description={selectedReasoning?.description}
                          aria-valuetext={displayReasoning}
                          className="claudian-model-slider-input"
                          max={String(reasoningOptions.length - 1)}
                          min="0"
                          step="1"
                          type="range"
                          value={String(selectedIndex)}
                          onInput={updateReasoningPreview}
                          onChange={(event) => {
                            const index = Number((event.currentTarget as HTMLInputElement).value);
                            const option = reasoningOptions[index];
                            if (option) onReasoningChange(option.value);
                          setReasoningPreviewIndex(null);
                          }}
                        />
                      </div>
                    </section>
                  )}
                  {serviceTier && (
                    <button
                      aria-checked={isServiceTierActive}
                      aria-label="Fast mode"
                      className={`claudian-model-service-tier${isServiceTierActive ? ' active' : ''}`}
                      role="switch"
                      title={serviceTier.description ?? (isServiceTierActive ? serviceTier.activeLabel : serviceTier.inactiveLabel)}
                      type="button"
                      onClick={onServiceTierToggle}
                    >
                      <ObsidianIcon className="claudian-model-service-tier-icon" icon="zap" />
                      <span>Fast</span>
                      <span aria-hidden="true" className="claudian-toggle-switch" />
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
