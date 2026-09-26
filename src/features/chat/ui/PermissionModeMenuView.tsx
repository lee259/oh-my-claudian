import { useLayoutEffect, useRef } from 'preact/hooks';

import type { ProviderPermissionModeOption } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { ObsidianIcon } from '../../../shared/ui/ObsidianIcon';

export type PermissionModeMenuOption = ProviderPermissionModeOption;

export interface PermissionModeMenuViewProps {
  id: string;
  label: string;
  options: PermissionModeMenuOption[];
  selectedValue: string;
  open: boolean;
  visible: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
}

export function PermissionModeMenuView({
  id,
  label,
  options,
  selectedValue,
  open,
  visible,
  onOpenChange,
  onSelect,
}: PermissionModeMenuViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const selectedOption = options.find(option => option.value === selectedValue);

  useLayoutEffect(() => {
    if (!open) return;
    (rootRef.current?.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-option[aria-checked="true"]',
    ) ?? rootRef.current?.querySelector<HTMLButtonElement>(
      '.claudian-permission-mode-option',
    ))?.focus();

    const ownerDocument = rootRef.current?.ownerDocument;
    if (!ownerDocument) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChangeRef.current(false);
    };
    ownerDocument.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open]);

  const handleMenuKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  const handleOptionKeydown = (event: KeyboardEvent): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const optionElements = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('.claudian-permission-mode-option') ?? [],
    );
    const currentIndex = optionElements.indexOf(event.target as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? optionElements.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + optionElements.length)
          % optionElements.length;
    optionElements[nextIndex]?.focus();
  };

  return (
    <div
      className={`claudian-permission-mode-menu${visible ? '' : ' claudian-hidden'}`}
      ref={rootRef}
      onKeyDown={handleMenuKeydown}
    >
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${selectedOption?.label ?? ''}`}
        className="claudian-permission-mode-trigger"
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
      >
        {selectedOption && (
          <ObsidianIcon
            className="claudian-permission-mode-trigger-icon"
            icon={selectedOption.icon ?? 'circle'}
          />
        )}
        <span className="claudian-permission-mode-trigger-label">
          {selectedOption?.label ?? label}
        </span>
        <ObsidianIcon
          className="claudian-permission-mode-trigger-chevron"
          icon={open ? 'chevron-up' : 'chevron-down'}
        />
      </button>
      <div
        aria-labelledby={`${id}-label`}
        className="claudian-permission-mode-popover"
        hidden={!open}
        id={id}
        role="dialog"
      >
        <div className="claudian-permission-mode-heading" id={`${id}-label`}>
          <span>{label}</span>
          <span
            aria-label={`${t('chat.composer.shiftKey')} + Tab ${t('chat.composer.switchModesHint')}`}
            className="claudian-permission-mode-hint"
          >
            <span aria-hidden="true" className="claudian-permission-mode-hint-keys">
              <kbd>⇧</kbd>
              <span>+</span>
              <kbd>Tab</kbd>
            </span>
            <span className="claudian-permission-mode-hint-copy">
              {t('chat.composer.switchModesHint')}
            </span>
          </span>
        </div>
        <div className="claudian-permission-mode-options" role="radiogroup" aria-label={label}>
          {options.map((option) => {
            const selected = option.value === selectedValue;
            return (
              <button
                aria-checked={selected}
                className={`claudian-permission-mode-option${selected ? ' is-selected' : ''}${option.isDangerous ? ' is-dangerous' : ''}`}
                data-mode-value={option.value}
                key={option.value}
                role="radio"
                tabIndex={selected ? 0 : -1}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  triggerRef.current?.focus();
                  onSelect(option.value);
                }}
                onKeyDown={handleOptionKeydown}
              >
                <ObsidianIcon
                  className="claudian-permission-mode-option-icon"
                  icon={option.icon ?? 'circle'}
                />
                <span className="claudian-permission-mode-option-copy">
                  <span className="claudian-permission-mode-option-label">{option.label}</span>
                  {option.description && (
                    <span className="claudian-permission-mode-option-description">
                      {option.description}
                    </span>
                  )}
                </span>
                {selected && <ObsidianIcon className="claudian-permission-mode-check" icon="check" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
