import { setIcon } from 'obsidian';

import { t } from '@/i18n/i18n';

/** A shared, non-interactive context-compaction marker for live and stored turns. */
export function renderCompactBoundary(parentEl: HTMLElement): HTMLElement {
  const boundaryEl = parentEl.createDiv({ cls: 'claudian-compact-boundary' });
  const iconEl = boundaryEl.createSpan({
    cls: 'claudian-compact-boundary-icon',
    attr: { 'aria-hidden': 'true' },
  });
  setIcon(iconEl, 'fold-vertical');
  boundaryEl.createSpan({ cls: 'claudian-compact-boundary-label', text: t('chat.activity.compacted') });
  return boundaryEl;
}
