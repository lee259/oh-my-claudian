import { useMemo, useRef, useState } from 'preact/hooks';

import { formatContextLimit, parseContextLimit } from '../../utils/env';
import {
  SettingsSaveFeedback,
  type SettingsSaveLabels,
  useSettingsSaveState,
} from './SettingsSaveFeedback';

export interface CustomModelOverrideItem {
  modelId: string;
  alias: string;
  contextLimit?: number;
}

export interface CustomModelOverridesViewProps {
  idPrefix: string;
  title: string;
  description: string;
  aliasLabel: string;
  contextLimitLabel: string;
  aliasPlaceholder: string;
  contextLimitPlaceholder: string;
  invalidContextLimitMessage: string;
  saveLabels: SettingsSaveLabels;
  items: readonly CustomModelOverrideItem[];
  onSaveAlias: (modelId: string, value: string) => Promise<void>;
  onSaveContextLimit: (modelId: string, value: number | null) => Promise<void>;
}

function getInitialValues(items: readonly CustomModelOverrideItem[]): Record<string, string> {
  return Object.fromEntries(items.map(item => [item.modelId, item.alias]));
}

function getInitialContextLimits(items: readonly CustomModelOverrideItem[]): Record<string, string> {
  return Object.fromEntries(items.map(item => [
    item.modelId,
    item.contextLimit ? formatContextLimit(item.contextLimit) : '',
  ]));
}

export function CustomModelOverridesView({
  idPrefix,
  title,
  description,
  aliasLabel,
  contextLimitLabel,
  aliasPlaceholder,
  contextLimitPlaceholder,
  invalidContextLimitMessage,
  saveLabels,
  items,
  onSaveAlias,
  onSaveContextLimit,
}: CustomModelOverridesViewProps) {
  const initialAliases = useMemo(() => getInitialValues(items), [items]);
  const initialLimits = useMemo(() => getInitialContextLimits(items), [items]);
  const [aliases, setAliases] = useState(() => initialAliases);
  const [contextLimits, setContextLimits] = useState(() => initialLimits);
  const [invalidModels, setInvalidModels] = useState<ReadonlySet<string>>(() => new Set());
  const aliasesRef = useRef(aliases);
  const savedAliasesRef = useRef(initialAliases);
  const contextLimitsRef = useRef(contextLimits);
  const savedContextLimitsRef = useRef(initialLimits);
  const aliasVersionsRef = useRef(new Map<string, number>());
  const contextLimitVersionsRef = useRef(new Map<string, number>());
  const { states, save } = useSettingsSaveState();

  const updateAlias = (modelId: string, value: string): void => {
    aliasesRef.current = { ...aliasesRef.current, [modelId]: value };
    setAliases(aliasesRef.current);
  };

  const updateContextLimit = (modelId: string, value: string): void => {
    contextLimitsRef.current = { ...contextLimitsRef.current, [modelId]: value };
    setContextLimits(contextLimitsRef.current);
  };

  const saveAlias = async (modelId: string): Promise<void> => {
    const value = aliasesRef.current[modelId].trim();
    if (value === savedAliasesRef.current[modelId]) return;

    const version = (aliasVersionsRef.current.get(modelId) ?? 0) + 1;
    aliasVersionsRef.current.set(modelId, version);
    const saved = await save(`alias:${modelId}`, () => onSaveAlias(modelId, value));
    if (aliasVersionsRef.current.get(modelId) !== version) return;
    if (saved) {
      savedAliasesRef.current = { ...savedAliasesRef.current, [modelId]: value };
      updateAlias(modelId, value);
    } else {
      updateAlias(modelId, savedAliasesRef.current[modelId]);
    }
  };

  const saveContextLimit = async (modelId: string, value: string): Promise<void> => {
    const version = (contextLimitVersionsRef.current.get(modelId) ?? 0) + 1;
    contextLimitVersionsRef.current.set(modelId, version);
    const trimmed = value.trim();
    const parsed = trimmed ? parseContextLimit(trimmed) : null;
    if (trimmed && parsed === null) {
      setInvalidModels(previous => new Set(previous).add(modelId));
      return;
    }

    setInvalidModels(previous => {
      const next = new Set(previous);
      next.delete(modelId);
      return next;
    });

    const saved = await save(`context-limit:${modelId}`, () => (
      onSaveContextLimit(modelId, trimmed ? parsed! : null)
    ));
    if (contextLimitVersionsRef.current.get(modelId) !== version) return;
    if (saved) {
      const savedValue = trimmed ? formatContextLimit(parsed!) : '';
      savedContextLimitsRef.current = { ...savedContextLimitsRef.current, [modelId]: savedValue };
      updateContextLimit(modelId, savedValue);
    } else {
      updateContextLimit(modelId, savedContextLimitsRef.current[modelId]);
    }
  };

  return (
    <section>
      <div className="claudian-context-limits-header">
        <span className="claudian-context-limits-label">{title}</span>
      </div>
      <div className="claudian-context-limits-desc">{description}</div>
      <div className="claudian-context-limits-list">
        {items.map((item) => {
          const invalid = invalidModels.has(item.modelId);
          const validationId = `${idPrefix}-context-limit-${encodeURIComponent(item.modelId)}`;
          return (
            <div className="claudian-context-limits-item" key={item.modelId}>
              <div className="claudian-context-limits-model">{item.modelId}</div>
              <div className="claudian-context-limits-input-wrapper">
                <div className="claudian-context-limits-field">
                  <input
                    aria-label={`${aliasLabel}: ${item.modelId}`}
                    className="claudian-context-alias-input"
                    placeholder={aliasPlaceholder}
                    value={aliases[item.modelId] ?? ''}
                    onInput={(event) => updateAlias(item.modelId, event.currentTarget.value)}
                    onBlur={() => void saveAlias(item.modelId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        updateAlias(item.modelId, savedAliasesRef.current[item.modelId]);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <SettingsSaveFeedback
                    labels={saveLabels}
                    state={states[`alias:${item.modelId}`]}
                  />
                </div>
                <div className="claudian-context-limits-field">
                  <input
                    aria-label={`${contextLimitLabel}: ${item.modelId}`}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? validationId : undefined}
                    className={`claudian-context-limits-input${invalid ? ' claudian-input-error' : ''}`}
                    placeholder={contextLimitPlaceholder}
                    value={contextLimits[item.modelId] ?? ''}
                    onInput={(event) => {
                      const value = event.currentTarget.value;
                      updateContextLimit(item.modelId, value);
                      void saveContextLimit(item.modelId, value);
                    }}
                  />
                  {invalid && (
                    <div
                      className="claudian-context-limit-validation"
                      id={validationId}
                      role="alert"
                    >
                      {invalidContextLimitMessage}
                    </div>
                  )}
                  <SettingsSaveFeedback
                    labels={saveLabels}
                    state={invalid ? undefined : states[`context-limit:${item.modelId}`]}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
