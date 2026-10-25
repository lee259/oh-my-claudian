import type { Ref } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { t } from '@/i18n/i18n';
import { ObsidianIcon } from '@/shared/ui/ObsidianIcon';

import type { ZenPreview } from './ZenModeController';

interface ZenModePanelViewProps {
  activity: ZenPreview;
  expanded: boolean;
  historyId: string;
  surface: HTMLElement;
  disclosureRef: Ref<HTMLButtonElement>;
  gripRef: Ref<HTMLButtonElement>;
  onToggleHistory: () => void;
}

/** Owns Zen controls; the slot hosts the existing chat without reconciling its children. */
export function ZenModePanelView({
  activity, expanded, historyId, surface, disclosureRef, gripRef, onToggleHistory,
}: ZenModePanelViewProps) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    slot.current?.appendChild(surface);
  }, [surface]);
  const hasHistory = activity.hasMessages || activity.requiresAction;
  return (
    <>
      <button
        ref={disclosureRef}
        className="claudian-zen-disclosure"
        type="button"
        hidden={!hasHistory}
        disabled={!hasHistory}
        aria-controls={historyId}
        aria-expanded={expanded}
        aria-label={t(expanded ? 'chat.zen.hideHistory' : 'chat.zen.showHistory')}
        onClick={onToggleHistory}
      >
        <ObsidianIcon icon="messages-square" />
        <span className="claudian-zen-preview">{activity.text || t('chat.zen.working')}</span>
      </button>
      <div className="claudian-zen-surface-slot" ref={slot} />
      <button
        ref={gripRef}
        className="claudian-zen-grip"
        type="button"
        aria-label={t('chat.zen.move')}
        title={t('chat.zen.move')}
      >
        <ObsidianIcon icon="grip-horizontal" />
      </button>
    </>
  );
}
