import { setIcon } from 'obsidian';

/** A shared, non-interactive context-compaction marker for live and stored turns. */
export function renderCompactBoundary(parentEl: HTMLElement): HTMLElement {
  const boundaryEl = parentEl.createDiv({ cls: 'claudian-compact-boundary' });
  const iconEl = boundaryEl.createSpan({
    cls: 'claudian-compact-boundary-icon',
    attr: { 'aria-hidden': 'true' },
  });
  setIcon(iconEl, 'fold-vertical');
  boundaryEl.createSpan({ cls: 'claudian-compact-boundary-label', text: 'Conversation compacted' });
  return boundaryEl;
}
