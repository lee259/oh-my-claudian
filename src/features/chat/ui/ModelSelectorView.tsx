import { useEffect, useRef, useState } from 'preact/hooks';

import type {
  ProviderIconSvg,
  ProviderReasoningOption,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import { ObsidianIcon } from '../../../shared/ui/ObsidianIcon';

export interface ModelSelectorViewProps {
  id: string;
  models: ProviderUIOption[];
  currentModel: string;
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
  const openFromKeyboardRef = useRef(false);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, reasoningOptions.findIndex(option => option.value === reasoningValue));
  const selectedReasoning = reasoningOptions[selectedIndex];
  const isServiceTierActive = Boolean(serviceTier && serviceTierActive);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (openFromKeyboardRef.current) {
      const selectedOption = root?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
      (selectedOption ?? root?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
      openFromKeyboardRef.current = false;
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
    const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
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
    const input = event.currentTarget as HTMLInputElement;
    const index = Number(input.value);
    const option = reasoningOptions[index];
    const section = input.closest('.claudian-thinking-selector');
    const slider = input.closest('.claudian-model-slider');
    if (!option || !section || !slider) return;

    const value = section.querySelector('.claudian-model-slider-value');
    if (value) value.textContent = option.label;
    input.setAttribute('aria-valuetext', option.label);
    if (option.description) input.setAttribute('aria-description', option.description);
    else input.removeAttribute('aria-description');

    slider.querySelectorAll('.claudian-model-slider-segment').forEach((segment, segmentIndex) => {
      segment.classList.toggle('is-filled', segmentIndex < index);
    });
    slider.querySelectorAll('.claudian-model-slider-tick').forEach((tick, tickIndex) => {
      tick.classList.toggle('is-filled', tickIndex <= index);
    });
  };

  const renderModelOption = (model: ProviderUIOption, index: number) => {
    const selected = model.value === currentModel;
    const modelIcon = model.providerIcon ?? providerIcon;
    return (
      <button
        aria-selected={selected}
        className={`claudian-model-option${selected ? ' selected' : ''}`}
        data-model-value={model.value}
        key={`${model.group ?? ''}:${model.value}`}
        role="option"
        tabIndex={selected || (!models.some(option => option.value === currentModel) && index === 0) ? 0 : -1}
        title={model.description}
        type="button"
        onClick={() => onModelChange(model)}
        onKeyDown={moveModelFocus}
      >
        {modelIcon && <ProviderIcon icon={modelIcon} />}
        <span className="claudian-model-option-label">{model.label}</span>
        {selected && <ObsidianIcon className="claudian-model-option-check" icon="check" />}
      </button>
    );
  };
  const orderedModels = [...models].reverse();
  const modelItems = [];
  let modelIndex = 0;
  while (modelIndex < orderedModels.length) {
    const model = orderedModels[modelIndex];
    if (!model.group) {
      modelItems.push(renderModelOption(model, modelIndex));
      modelIndex++;
      continue;
    }

    const group = model.group;
    const groupStart = modelIndex;
    while (modelIndex < orderedModels.length && orderedModels[modelIndex]?.group === group) modelIndex++;
    modelItems.push(
      <div
        aria-labelledby={`${id}-heading-${groupStart}`}
        className="claudian-model-group"
        key={`${group}:${groupStart}`}
        role="group"
      >
        <div className="claudian-model-group-label" id={`${id}-heading-${groupStart}`}>{group}</div>
        {orderedModels.slice(groupStart, modelIndex).map((groupModel, offset) => (
          renderModelOption(groupModel, groupStart + offset)
        ))}
      </div>,
    );
  }

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
          setOpen(value => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openFromKeyboardRef.current = true;
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
        <div className="claudian-model-options">
          {models.length > 0
            ? <div aria-label="Model" className="claudian-model-list" role="listbox">{modelItems}</div>
            : <div className="claudian-model-empty" role="status">No models available. Check provider settings and refresh the model list if discovery failed.</div>}
        </div>

        {(reasoningHasChoice || serviceTier) && (
          <div className="claudian-model-menu-footer">
            {serviceTier && (
              <section className="claudian-model-menu-section claudian-service-tier-toggle">
                <button
                  aria-checked={isServiceTierActive}
                  className={`claudian-model-service-tier${isServiceTierActive ? ' active' : ''}`}
                  role="switch"
                  title={serviceTier.description}
                  type="button"
                  onClick={onServiceTierToggle}
                >
                  <ObsidianIcon className="claudian-model-service-tier-icon" icon="zap" />
                  <span className="claudian-model-service-tier-label">Fast mode</span>
                  <span className="claudian-model-service-tier-status">
                    {isServiceTierActive ? serviceTier.activeLabel : serviceTier.inactiveLabel}
                  </span>
                  <span aria-hidden="true" className="claudian-toggle-switch" />
                </button>
              </section>
            )}

            {reasoningHasChoice && (
              <section aria-label={reasoningLabel} className="claudian-model-menu-section claudian-thinking-selector">
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
                    }}
                  />
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
