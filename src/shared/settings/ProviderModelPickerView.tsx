import { useState } from 'preact/hooks';

import type {
  ProviderModelPickerModel,
  ProviderModelPickerOptions,
  ProviderModelPickerState,
} from './ProviderModelPicker';

const ALL_PROVIDERS_KEY = 'all';

export interface ProviderModelPickerViewProps {
  options: ProviderModelPickerOptions;
  state: ProviderModelPickerState;
  loadingCatalog: boolean;
  catalogLoadFailed: boolean;
  onLoadCatalog(force: boolean): void;
  onAliasesChange(aliases: Record<string, string>): Promise<void>;
  onSelectedIdsChange(selectedIds: string[]): Promise<void>;
}

function reorderProviderModelIds(
  selectedIds: readonly string[],
  modelId: string,
  targetIndex: number,
): string[] {
  const currentIndex = selectedIds.indexOf(modelId);
  if (currentIndex < 0) return [...selectedIds];
  const next = [...selectedIds];
  next.splice(currentIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, modelId);
  return next;
}

export function ProviderModelPickerView({
  options,
  state,
  loadingCatalog,
  catalogLoadFailed,
  onLoadCatalog,
  onAliasesChange,
  onSelectedIdsChange,
}: ProviderModelPickerViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS_KEY);
  const [draggedModelId, setDraggedModelId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(
    options.initiallyOpen ?? state.selectedIds.length === 0,
  );
  const providers = new Map<string, { count: number; label: string }>();
  for (const model of state.models) {
    if (!model.providerKey || !model.providerLabel) continue;
    const existing = providers.get(model.providerKey);
    if (existing) existing.count += 1;
    else providers.set(model.providerKey, { count: 1, label: model.providerLabel });
  }
  const effectiveProviderFilter = providers.has(providerFilter) || providerFilter === ALL_PROVIDERS_KEY
    ? providerFilter
    : ALL_PROVIDERS_KEY;
  const filteredModels = state.models.filter((model) => {
    if (effectiveProviderFilter !== ALL_PROVIDERS_KEY && model.providerKey !== effectiveProviderFilter) {
      return false;
    }
    const query = searchQuery.trim().toLowerCase();
    return !query || [model.id, model.name, model.providerLabel ?? '', model.description ?? '']
      .some(value => value.toLowerCase().includes(query));
  });
  const selectedIds = new Set(state.selectedIds);
  const defaultModelId = state.defaultModelId === undefined
    ? state.selectedIds[0]
    : state.defaultModelId;
  const catalogStatus = catalogLoadFailed ? 'failed' : state.catalogStatus ?? 'empty';

  const persistAlias = async (modelId: string, value: string): Promise<void> => {
    const existing = state.aliases[modelId] ?? '';
    const next = value.trim();
    if (next === existing) return;
    const aliases = { ...state.aliases };
    if (next) aliases[modelId] = next;
    else delete aliases[modelId];
    await onAliasesChange(aliases);
  };

  const persistSelectedIds = async (nextIds: string[]): Promise<void> => {
    await onSelectedIdsChange(nextIds);
  };

  const selectedModels = state.selectedIds.map((modelId) => {
    const model = state.models.find(candidate => candidate.id === modelId) ?? {
      id: modelId,
      isAvailable: false,
      name: modelId,
    };
    const defaultLabel = model.aliasPlaceholder
      ?? (model.providerLabel ? `${model.providerLabel}/${model.name}` : model.name);
    const move = (offset: number): void => {
      const currentIndex = state.selectedIds.indexOf(modelId);
      const targetIndex = currentIndex + offset;
      if (targetIndex < 0 || targetIndex >= state.selectedIds.length) return;
      void persistSelectedIds(reorderProviderModelIds(state.selectedIds, modelId, targetIndex));
    };
    return (
      <div
        className={`claudian-provider-model-picker-selected-row${model.isAvailable === false ? ' claudian-provider-model-picker-selected-row--unavailable' : ''}`}
        data-model-id={modelId}
        key={modelId}
        onDragOver={(event) => {
          if (!draggedModelId || draggedModelId === modelId) return;
          event.preventDefault();
          event.currentTarget.classList.add('claudian-provider-model-picker-selected-row--drop-target');
        }}
        onDragLeave={(event) => event.currentTarget.classList.remove('claudian-provider-model-picker-selected-row--drop-target')}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove('claudian-provider-model-picker-selected-row--drop-target');
          const sourceModelId = draggedModelId ?? event.dataTransfer?.getData('text/plain') ?? '';
          setDraggedModelId(null);
          if (!sourceModelId || sourceModelId === modelId) return;
          const targetIndex = state.selectedIds.indexOf(modelId);
          void persistSelectedIds(reorderProviderModelIds(state.selectedIds, sourceModelId, targetIndex));
        }}
      >
        <button
          type="button"
          className="claudian-provider-model-picker-selected-drag"
          aria-label={`Reorder ${defaultLabel}; drag or use the Up and Down Arrow keys`}
          title="Drag or use arrow keys to reorder"
          draggable={state.selectedIds.length > 1}
          onDragStart={(event) => {
            setDraggedModelId(modelId);
            event.currentTarget.closest('.claudian-provider-model-picker-selected-row')
              ?.classList.add('claudian-provider-model-picker-selected-row--dragging');
            event.dataTransfer?.setData('text/plain', modelId);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={(event) => {
            setDraggedModelId(null);
            event.currentTarget.closest('.claudian-provider-model-picker-selected-row')
              ?.classList.remove('claudian-provider-model-picker-selected-row--dragging');
          }}
          onKeyDown={(event) => {
            const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
            if (offset === 0) return;
            event.preventDefault();
            move(offset);
          }}
        >
          ⋮⋮
        </button>
        <div className="claudian-provider-model-picker-selected-info">
          <div className="claudian-provider-model-picker-selected-title">
            {model.providerLabel && (
              <span className="claudian-provider-model-picker-selected-badge">{model.providerLabel}</span>
            )}
            <span className="claudian-provider-model-picker-selected-name">{model.name}</span>
            {modelId === defaultModelId && (
              <span className="claudian-provider-model-picker-selected-default">Default</span>
            )}
          </div>
          {model.isAvailable === false && model.unavailableMessage && (
            <div className="claudian-provider-model-picker-selected-unavailable">{model.unavailableMessage}</div>
          )}
          <div className="claudian-provider-model-picker-selected-id">{model.id}</div>
        </div>
        <div className="claudian-provider-model-picker-selected-controls">
          <label className="claudian-provider-model-picker-selected-alias-field">
            <span className="claudian-provider-model-picker-selected-alias-label">Alias (optional)</span>
            <input
              className="claudian-provider-model-picker-selected-alias"
              type="text"
              placeholder={defaultLabel}
              value={state.aliases[model.id] ?? ''}
              aria-label={`Alias for ${defaultLabel}`}
              title="Custom label shown in the model selector. Leave empty to use the default."
              onBlur={(event) => void persistAlias(model.id, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.currentTarget.value = state.aliases[model.id] ?? '';
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="claudian-provider-model-picker-selected-remove"
            aria-label={`Remove ${defaultLabel}`}
            onClick={() => void persistSelectedIds(state.selectedIds.filter(id => id !== model.id))}
          >
            ×
          </button>
        </div>
      </div>
    );
  });

  return (
    <div
      className={`claudian-provider-model-picker claudian-provider-model-picker--${options.modifier}`}
      data-catalog-status={catalogStatus}
    >
      <div className="claudian-provider-model-picker-summary">
        <span>Visible: </span>
        <span className="claudian-provider-model-picker-summary-value">{state.selectedIds.length}</span>
        <span>
          {` of ${state.discoveredCount} discovered`}
          {providers.size > 0 && ` | ${providers.size} ${providers.size === 1 ? 'provider' : 'providers'}`}
        </span>
      </div>
      <div className={`claudian-provider-model-picker-selected${state.selectedIds.length ? '' : ' claudian-hidden'}`}>
        {state.selectedIds.length > 0 && (
          <>
            <div className="claudian-provider-model-picker-selected-header">
              <span className="claudian-provider-model-picker-selected-label">Selected ({state.selectedIds.length})</span>
              <button
                type="button"
                className="claudian-provider-model-picker-selected-clear"
                aria-label={`Clear all selected ${options.providerName} models`}
                onClick={() => void persistSelectedIds([])}
              >
                Clear all
              </button>
            </div>
            <div className="claudian-provider-model-picker-selected-rows">{selectedModels}</div>
          </>
        )}
      </div>
      <details
        className="claudian-provider-model-picker-catalog"
        open={catalogOpen}
        onToggle={(event) => {
          const isOpen = event.currentTarget.open;
          setCatalogOpen(isOpen);
          if (isOpen) onLoadCatalog(false);
        }}
      >
        <summary className="claudian-provider-model-picker-catalog-summary">
          <span className="claudian-provider-model-picker-catalog-caret">▸</span>
          <span className="claudian-provider-model-picker-catalog-title">Browse models</span>
          <span className="claudian-provider-model-picker-catalog-count">
            {loadingCatalog
              ? 'Loading models...'
              : state.discoveredCount > 0
              ? `${state.discoveredCount} available`
              : 'No models discovered yet'}
          </span>
        </summary>
        <div className="claudian-provider-model-picker-controls">
          <input
            className="claudian-provider-model-picker-search"
            type="search"
            placeholder={options.searchPlaceholder ?? 'Filter by model, provider, or ID...'}
            value={searchQuery}
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
          />
          <select
            className={`claudian-provider-model-picker-provider${providers.size === 0 ? ' claudian-hidden' : ''}`}
            value={effectiveProviderFilter}
            onChange={(event) => setProviderFilter(event.currentTarget.value)}
          >
            <option value={ALL_PROVIDERS_KEY}>{`All providers (${state.models.length})`}</option>
            {[...providers.entries()]
              .sort(([, left], [, right]) => left.label.localeCompare(right.label))
              .map(([key, provider]) => (
                <option value={key} key={key}>{`${provider.label} (${provider.count})`}</option>
              ))}
          </select>
          <button
            type="button"
            className="claudian-provider-model-picker-action"
            disabled={loadingCatalog}
            onClick={() => onLoadCatalog(true)}
          >
            {loadingCatalog ? 'Loading...' : state.discoveredCount > 0 ? 'Refresh' : 'Discover'}
          </button>
        </div>
        <div className="claudian-provider-model-picker-list">
          {filteredModels.length === 0 ? (
            <div className="claudian-provider-model-picker-empty">
              {loadingCatalog
                ? options.loadingCatalogText
                : catalogLoadFailed
                ? options.failedCatalogText
                : state.models.length === 0
                ? options.emptyCatalogText
                : 'No models match your filter.'}
            </div>
          ) : filteredModels.map((model: ProviderModelPickerModel) => {
            const isSelected = selectedIds.has(model.id);
            const badgeLabel = model.isAvailable === false
              ? 'Unavailable'
              : model.catalogBadge ?? model.providerLabel;
            return (
              <label
                className={`claudian-provider-model-picker-row${isSelected ? ' claudian-provider-model-picker-row--selected' : ''}`}
                title={model.id}
                key={model.id}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={async (event) => {
                    const selecting = event.currentTarget.checked;
                    const currentIds = options.getState().selectedIds;
                    const nextIds = selecting
                      ? [...currentIds, model.id]
                      : currentIds.filter(id => id !== model.id);
                    await persistSelectedIds(nextIds);
                    if (selecting) await options.onModelSelected?.(model);
                  }}
                />
                <div className="claudian-provider-model-picker-row-text">
                  <div className="claudian-provider-model-picker-row-header">
                    <span className="claudian-provider-model-picker-row-name">{model.name}</span>
                    {badgeLabel && (
                      <span
                        className={`claudian-provider-model-picker-row-badge${model.isAvailable === false ? ' claudian-provider-model-picker-row-badge--unavailable' : ''}`}
                        title={model.isAvailable === false
                          ? model.unavailableTitle ?? `Configured model not currently reported by ${options.providerName}`
                          : undefined}
                      >
                        {badgeLabel}
                      </span>
                    )}
                  </div>
                  <div className="claudian-provider-model-picker-row-meta">{model.id}</div>
                  {model.description && <div className="claudian-provider-model-picker-row-desc">{model.description}</div>}
                </div>
              </label>
            );
          })}
        </div>
      </details>
    </div>
  );
}
