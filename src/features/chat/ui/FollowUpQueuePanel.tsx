import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { t } from '@/i18n/i18n';
import { ObsidianIcon } from '@/shared/ui/ObsidianIcon';

import type { FollowUpItem } from '../state/FollowUpQueue';

export interface FollowUpQueuePanelProps {
  items: readonly FollowUpItem[];
  paused: boolean;
  showResume: boolean;
  canSteer: boolean;
  unavailableReason: string;
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
  onDismiss: (id: string) => void;
  onResume: () => void;
  onMore: (item: FollowUpItem, anchor: HTMLElement) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onMoveTo: (id: string, targetId: string, after: boolean) => void;
}

interface QueueActionProps {
  label: string;
  action: string;
  itemId?: string;
  icon?: string;
  disabled?: boolean;
  title?: string;
  menu?: boolean;
  onClick: (event: MouseEvent) => void;
  children?: ComponentChildren;
}

function QueueAction({ label, action, itemId, icon, disabled, title, menu, onClick, children }: QueueActionProps) {
  return (
    <button className="claudian-follow-up-action" type="button" aria-label={label}
      aria-haspopup={menu ? 'menu' : undefined} title={title ?? label} data-action={action}
      data-focus={itemId ? `${itemId}:${action}` : undefined} disabled={disabled} onClick={onClick}>
      {icon ? <ObsidianIcon icon={icon} /> : label}{children}
    </button>
  );
}

function QueueMessageDetails({ item }: { item: FollowUpItem }) {
  const request = item.message.turnRequest;
  const contexts = [...new Set([request?.currentNotePath, ...(request?.contextFiles ?? []),
    request?.editorSelection?.notePath, request?.browserSelection?.url,
    request?.canvasSelection?.canvasPath, ...(request?.externalContextPaths ?? [])]
    .filter((value): value is string => !!value))];
  const selections = [request?.editorSelection?.selectedText, request?.browserSelection?.selectedText,
    request?.canvasSelection?.nodeIds.join(', ')].filter((value): value is string => !!value);
  const images = item.message.images ?? [];
  const attachmentCount = contexts.length + images.length;
  return (
    <>
      <details className="claudian-follow-up-details">
        <summary title={item.message.content} data-focus={`${item.id}:details`} dir="auto">
          {item.message.content || t('chat.followUp.details')}
        </summary>
        <div className="claudian-follow-up-detail-body">
          <div className="claudian-follow-up-content">{item.message.content}</div>
          {contexts.map(context => <div className="claudian-follow-up-context" key={context}>{context}</div>)}
          {selections.map((selection, index) => (
            <div className="claudian-follow-up-selection" key={index}>{t('chat.followUp.selection')}: {selection}</div>
          ))}
          {images.map((image, index) => <div className="claudian-follow-up-context" key={index}>{image.name}</div>)}
        </div>
      </details>
      {attachmentCount > 0 && (
        <span className="claudian-follow-up-attachments" aria-label={`${t('chat.followUp.files', { count: contexts.length })}, ${t('chat.followUp.images', { count: images.length })}`}>
          <ObsidianIcon icon="paperclip" /><span>{attachmentCount}</span>
        </span>
      )}
    </>
  );
}

/** Keyed presentation only; input and provider acceptance remain in the runtime queue. */
export function FollowUpQueuePanel(props: FollowUpQueuePanelProps) {
  const dragging = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const clearDrag = () => { dragging.current = null; setDraggingId(null); setDropTarget(null); };
  if (!props.items.length) return null;
  return (
    <>
      <div className="claudian-follow-up-list" role="list" aria-label={t('chat.followUp.title', { count: props.items.length })}>
        {props.items.map(item => (
          <div className={`claudian-follow-up-item${draggingId === item.id ? ' claudian-follow-up-item--dragging' : ''}`}
            role="listitem" data-id={item.id} data-status={item.status} key={item.id}
            data-drop={dropTarget?.id === item.id ? dropTarget.after ? 'after' : 'before' : undefined}
            onDragOver={event => {
              if (item.status !== 'queued' || !dragging.current || dragging.current === item.id) return;
              event.preventDefault(); event.stopPropagation();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              const rect = event.currentTarget.getBoundingClientRect();
              setDropTarget({ id: item.id, after: event.clientY > rect.top + rect.height / 2 });
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={event => {
              if (item.status !== 'queued' || !dragging.current) return;
              event.preventDefault(); event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const source = dragging.current;
              clearDrag();
              props.onMoveTo(source, item.id, event.clientY > rect.top + rect.height / 2);
            }}>
            <div className="claudian-follow-up-line">
              {item.status === 'queued' ? (
                <button className="claudian-follow-up-action claudian-follow-up-handle" type="button"
                  aria-label={t('chat.followUp.reorder')} title={t('chat.followUp.reorder')}
                  data-action="reorder" data-focus={`${item.id}:reorder`} draggable
                  onKeyDown={event => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                    event.preventDefault(); event.stopPropagation();
                    props.onMove(item.id, event.key === 'ArrowUp' ? -1 : 1);
                  }}
                  onDragStart={event => {
                    dragging.current = item.id; setDraggingId(item.id); event.stopPropagation();
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('application/x-claudian-follow-up', item.id);
                    }
                  }} onDragEnd={clearDrag}><ObsidianIcon icon="list-end" /></button>
              ) : <span className="claudian-follow-up-marker" aria-hidden="true"><ObsidianIcon icon="circle-alert" /></span>}
              <QueueMessageDetails item={item} />
              <div className="claudian-follow-up-actions">
                {item.status === 'queued' ? (
                  <>
                    <QueueAction itemId={item.id} label={t('chat.followUp.steer')} action="steer" icon="corner-down-right"
                      disabled={!props.canSteer} title={!props.canSteer ? props.unavailableReason : undefined}
                      onClick={() => props.onSteer(item.id)}><span>{t('chat.followUp.steerMode')}</span></QueueAction>
                    <QueueAction itemId={item.id} label={t('common.delete')} action="remove" icon="trash-2"
                      onClick={() => props.onRemove(item.id)} />
                    <QueueAction itemId={item.id} label={t('chat.followUp.more')} action="more" icon="ellipsis" menu
                      onClick={event => props.onMore(item, event.currentTarget as HTMLElement)} />
                  </>
                ) : (
                  <>
                    <span className="claudian-follow-up-status" role="status">{t(`chat.followUp.${item.status}`)}</span>
                    <QueueAction itemId={item.id} label={t('chat.followUp.dismiss')} action="dismiss" icon="x"
                      onClick={() => props.onDismiss(item.id)} />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {props.showResume && (
        <div className="claudian-follow-up-footer">
          {props.paused && <span className="claudian-follow-up-paused">{t('chat.followUp.paused')}</span>}
          <QueueAction label={t('chat.followUp.resume')} action="resume" onClick={props.onResume} />
        </div>
      )}
    </>
  );
}
