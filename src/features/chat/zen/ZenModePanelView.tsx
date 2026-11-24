import type { Ref } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { VisibilityGatedPoller } from '@/features/chat/controllers/VisibilityGatedPoller';
import { t } from '@/i18n/i18n';
import { ObsidianIcon } from '@/shared/ui/ObsidianIcon';

import type { ZenPreview } from './ZenModeController';

interface ZenModePanelViewProps {
  activity: ZenPreview;
  expanded: boolean;
  minimized: boolean;
  historyId: string;
  conversationPickerId: string;
  conversationPickerOpen: boolean;
  surface: HTMLElement;
  surfaceId: string;
  disclosureRef: Ref<HTMLButtonElement>;
  gripRef: Ref<HTMLButtonElement>;
  minimizeRef: Ref<HTMLButtonElement>;
  onToggleHistory: () => void;
  onToggleConversationPicker: (trigger: HTMLButtonElement) => void;
  onToggleMinimized: () => void;
}

/** Owns Zen controls; the slot hosts the existing chat without reconciling its children. */
export function ZenModePanelView({
  activity, expanded, minimized, historyId, conversationPickerId, conversationPickerOpen, surface, surfaceId,
  disclosureRef, gripRef, minimizeRef, onToggleHistory, onToggleConversationPicker, onToggleMinimized,
}: ZenModePanelViewProps) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    slot.current?.appendChild(surface);
  }, [surface]);
  const hasHistory = activity.hasMessages || activity.requiresAction;
  const showHistory = expanded && hasHistory;
  const title = activity.title ?? (activity.text || t('chat.home.title'));
  const disclosureLabel = t(showHistory ? 'chat.zen.hideHistory' : 'chat.zen.showHistory');
  const status = activity.requiresAction ? t('chat.zen.actionRequired') : activity.working ? t('chat.zen.working') : '';
  const toggleLabel = t(minimized ? 'chat.zen.restore' : 'chat.zen.minimize');
  const toggleIcon = activity.requiresAction ? 'circle-alert' : activity.working ? 'loader-circle' : 'messages-square';
  return (
    <>
      <div className="claudian-zen-header">
        <button
          className="claudian-zen-conversation-picker"
          type="button"
          hidden={minimized}
          aria-controls={conversationPickerId}
          aria-expanded={conversationPickerOpen}
          aria-label={`${title} · ${t('chat.zen.switchConversation')}`}
          data-tooltip-position="top"
          onClick={event => {
            event.stopPropagation();
            onToggleConversationPicker(event.currentTarget);
          }}
        >
          <ObsidianIcon icon="messages-square" />
          <span className="claudian-zen-title claudian-zen-preview">{title}</span>
          <ObsidianIcon className="claudian-zen-chevron" icon={conversationPickerOpen ? 'chevron-up' : 'chevron-down'} />
        </button>
        {!minimized && status && (
          <span
            className="claudian-zen-status"
            role={showHistory ? 'img' : undefined}
            aria-label={showHistory ? status : undefined}
            data-tooltip-position={showHistory ? 'left' : undefined}
          >
            <ObsidianIcon icon={activity.requiresAction ? 'circle-alert' : 'loader-circle'} />
            {!showHistory && (activity.startedAt == null || activity.requiresAction
              ? <span className="claudian-zen-preview">{status}</span>
              : <ZenElapsedTime startedAt={activity.startedAt} ownerDocument={surface.ownerDocument} />)}
          </span>
        )}
        <button
          ref={disclosureRef}
          className="claudian-zen-disclosure"
          type="button"
          hidden={minimized || !hasHistory}
          disabled={activity.requiresAction}
          aria-controls={historyId}
          aria-expanded={showHistory}
          aria-label={disclosureLabel}
          data-tooltip-position="top"
          onClick={onToggleHistory}
        >
          <ObsidianIcon icon={showHistory ? 'panel-top-close' : 'panel-top-open'} />
        </button>
        <button
          ref={minimizeRef}
          className="claudian-zen-minimize"
          type="button"
          aria-controls={surfaceId}
          aria-expanded={!minimized}
          aria-label={minimized && status ? `${toggleLabel}, ${status}` : toggleLabel}
          data-tooltip-position={minimized ? 'top' : 'left'}
          onClick={onToggleMinimized}
        >
          <ObsidianIcon icon={minimized ? toggleIcon : 'minus'} />
        </button>
      </div>
      <div id={surfaceId} className="claudian-zen-surface-slot" ref={slot} hidden={minimized} />
      <button
        ref={gripRef}
        className="claudian-zen-grip"
        type="button"
        hidden={minimized}
        aria-label={t('chat.zen.move')}
        title={t('chat.zen.move')}
      >
        <ObsidianIcon icon="grip-horizontal" />
      </button>
    </>
  );
}

function ZenElapsedTime({ startedAt, ownerDocument }: { startedAt: number; ownerDocument: Document }) {
  const [seconds, setSeconds] = useState(0);
  useLayoutEffect(() => {
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;
    const update = () => setSeconds(Math.max(0, Math.floor((ownerWindow.performance.now() - startedAt) / 1_000)));
    const poller = new VisibilityGatedPoller({ ownerDocument, ownerWindow, intervalMs: 1_000, poll: update });
    update();
    poller.start();
    return () => poller.stop();
  }, [ownerDocument, startedAt]);
  const minutes = Math.floor(seconds / 60);
  return (
    <span className="claudian-zen-preview" role="timer">
      {minutes > 0
        ? t('chat.completedWork.inProgressMinutes', { minutes, seconds: seconds % 60 })
        : t('chat.completedWork.inProgress', { seconds })}
    </span>
  );
}
