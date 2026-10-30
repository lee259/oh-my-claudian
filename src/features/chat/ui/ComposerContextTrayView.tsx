import { t } from '@/i18n/i18n';
import { ObsidianIcon } from '@/shared/ui/ObsidianIcon';

import type { ComposerContextItem, ComposerContextSlot } from './ComposerContextTray';

export interface ContextTrayEntry {
  slot: ComposerContextSlot;
  item: ComposerContextItem;
}

export interface ContextTrayLayout {
  hiddenIndices: ReadonlySet<number>;
  showMore: boolean;
  expanded: boolean;
}

export function ComposerContextTrayView({ entries, layout, onToggleMore, onAlignPreview }: {
  entries: readonly ContextTrayEntry[];
  layout: ContextTrayLayout;
  onToggleMore: () => void;
  onAlignPreview: (chip: HTMLElement) => void;
}) {
  const hiddenCount = layout.hiddenIndices.size;
  return (
    <>
      {entries.map(({ slot, item }, index) => {
        const classes = [
          'claudian-context-chip', `claudian-context-chip--${item.kind}`,
          item.preview && 'claudian-context-chip--preview',
          item.onRemove && 'claudian-context-chip--removable',
          layout.hiddenIndices.has(index) && 'claudian-context-chip--overflow-hidden',
        ].filter(Boolean).join(' ');
        const label = item.ariaLabel ?? item.label;
        const content = <>
          {item.icon && <ObsidianIcon className="claudian-context-chip-icon" icon={item.icon} />}
          <span className="claudian-context-chip-label">{item.label}</span>
        </>;
        return (
          <div key={`${slot}:${item.id}`} className={classes} data-context-slot={slot} data-context-id={item.id}
            tabIndex={item.preview ? 0 : undefined} role={item.preview ? 'group' : undefined}
            aria-label={item.preview ? label : undefined}
            onMouseEnter={item.preview ? event => onAlignPreview(event.currentTarget) : undefined}
            onFocusIn={item.preview ? event => onAlignPreview(event.currentTarget) : undefined}>
            {item.preview && <div className="claudian-context-chip-preview">
              <div className="claudian-context-chip-preview-header">
                <span className="claudian-context-chip-preview-heading">{item.preview.heading}</span>
                <div className="claudian-context-chip-preview-actions">
                  <button className="claudian-context-chip-preview-action claudian-context-chip-preview-action--delete"
                    type="button" aria-label={item.preview.deleteLabel} title={item.preview.deleteLabel} onClick={item.preview.onDelete}>
                    <ObsidianIcon icon="trash-2" />
                  </button>
                </div>
              </div>
              <div className="claudian-context-chip-preview-content" aria-live="polite">{item.preview.content}</div>
            </div>}
            {item.onActivate
              ? <button className="claudian-context-chip-main" type="button" title={!item.preview ? item.title : undefined}
                aria-label={label} onClick={item.onActivate}>{content}</button>
              : <span className="claudian-context-chip-main" title={!item.preview ? item.title : undefined} aria-label={label}>{content}</span>}
            {item.onRemove && <button className="claudian-context-chip-remove" type="button"
              aria-label={item.removeLabel ?? `Remove ${label}`} onClick={item.onRemove}>×</button>}
          </div>
        );
      })}
      {entries.length > 0 && <button className={`claudian-context-more${layout.showMore ? '' : ' claudian-hidden'}`}
        type="button" aria-expanded={layout.expanded}
        aria-label={layout.showMore && !layout.expanded ? t('chat.composer.showMore', { count: hiddenCount }) : undefined}
        onClick={onToggleMore}>
        {layout.showMore ? (layout.expanded ? t('chat.composer.showLess') : t('chat.composer.more', { count: hiddenCount })) : ''}
      </button>}
    </>
  );
}
