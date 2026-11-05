import { setIcon } from 'obsidian';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { t } from '../../../i18n/i18n';
import { IconButton } from '../../../shared/ui/IconButton';

export interface ConversationHeaderViewProps {
  title: string;
  isHome?: boolean;
  onBack?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onNewConversation?: () => void;
  onRenameConversation?: () => void;
  onArchiveConversation?: () => void;
  isRunning?: boolean;
}

export function ConversationHeaderView({
  title,
  isHome = false,
  onBack,
  onOpenHistory,
  onOpenSettings,
  onNewConversation,
  onRenameConversation,
  onArchiveConversation,
  isRunning = false,
}: ConversationHeaderViewProps) {
  const [isConversationMenuOpen, setIsConversationMenuOpen] = useState(false);
  const conversationMenuAnchorRef = useRef<HTMLDivElement>(null);

  const pendingMenuFocus = useRef<'first' | 'last' | null>(null);

  useLayoutEffect(() => {
    setIsConversationMenuOpen(false);
  }, [isHome]);

  useLayoutEffect(() => {
    if (!isConversationMenuOpen || !pendingMenuFocus.current) return;
    const items = conversationMenuAnchorRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    const target = pendingMenuFocus.current === 'last' ? items?.[items.length - 1] : items?.[0];
    pendingMenuFocus.current = null;
    target?.focus();
  }, [isConversationMenuOpen]);

  useEffect(() => {
    if (isHome) return undefined;
    const ownerDocument = conversationMenuAnchorRef.current?.ownerDocument;
    if (!ownerDocument) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!conversationMenuAnchorRef.current?.contains(event.target as Node)) {
        setIsConversationMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      const anchor = conversationMenuAnchorRef.current;
      const trigger = anchor?.querySelector<HTMLButtonElement>('.claudian-conversation-header-menu-action');
      const active = ownerDocument.activeElement;
      const inside = anchor?.contains(active) ?? false;
      const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
      if (!isConversationMenuOpen) {
        if (!arrow || active !== trigger) return;
        event.preventDefault();
        event.stopPropagation();
        pendingMenuFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
        setIsConversationMenuOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        if (inside) {
          event.preventDefault();
          event.stopPropagation();
          trigger?.focus();
        }
        setIsConversationMenuOpen(false);
        return;
      }
      if (!inside) return;
      if (event.key === 'Tab') {
        trigger?.focus();
        setIsConversationMenuOpen(false);
        return;
      }
      if (!arrow && event.key !== 'Home' && event.key !== 'End') return;
      const items = Array.from(anchor!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      const index = items.indexOf(active as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : index < 0 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    };

    ownerDocument.addEventListener('pointerdown', handlePointerDown);
    ownerDocument.addEventListener('keydown', handleKeyDown, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown);
      ownerDocument.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isConversationMenuOpen, isHome]);

  const openConversationMenu = (event: MouseEvent): void => {
    event.stopPropagation();
    pendingMenuFocus.current = 'first';
    setIsConversationMenuOpen(open => !open);
  };

  if (isHome) {
    return (
      <header className="claudian-conversation-header claudian-conversation-header--home">
        <div className="claudian-home-title">{t('chat.home.title')}</div>
        <div className="claudian-conversation-header-actions">
          <IconButton
            className="claudian-conversation-header-action"
            iconClassName="claudian-conversation-header-icon"
            icon="history"
            label={t('chat.home.history')}
            onClick={onOpenHistory}
          />
          <IconButton
            className="claudian-conversation-header-action"
            iconClassName="claudian-conversation-header-icon"
            icon="settings"
            label={t('chat.home.settings')}
            onClick={onOpenSettings}
          />
          <IconButton
            className="claudian-conversation-header-action"
            iconClassName="claudian-conversation-header-icon"
            icon="square-pen"
            label={t('chat.home.newConversation')}
            onClick={onNewConversation}
          />
        </div>
      </header>
    );
  }

  return (
    <header className="claudian-conversation-header">
      <div className="claudian-conversation-header-leading">
        <IconButton
          className="claudian-conversation-header-action"
          icon="arrow-left"
          iconClassName="claudian-conversation-header-icon"
          label={t('chat.header.back')}
          onClick={onBack}
        />
        <div className="claudian-conversation-header-title-wrap">
          <div className="claudian-conversation-header-title">
            {title}
          </div>
        </div>
      </div>
      <div
        className="claudian-conversation-header-actions"
        ref={conversationMenuAnchorRef}
      >
        {(onRenameConversation || onArchiveConversation) && (
          <div className="claudian-conversation-menu-anchor">
            <IconButton
              className="claudian-conversation-header-action claudian-conversation-header-menu-action"
              icon="more-horizontal"
              iconClassName="claudian-conversation-header-icon"
              label={t('chat.history.options')}
              ariaExpanded={isConversationMenuOpen}
              ariaHasPopup="menu"
              onClick={openConversationMenu}
            />
          </div>
        )}
        <IconButton
          className="claudian-conversation-header-action"
          icon="history"
          iconClassName="claudian-conversation-header-icon"
          label={t('chat.header.history')}
          onClick={onOpenHistory}
        />
        <IconButton
          className="claudian-conversation-header-action"
          icon="settings"
          iconClassName="claudian-conversation-header-icon"
          label={t('chat.header.settings')}
          onClick={onOpenSettings}
        />
        <IconButton
          className="claudian-conversation-header-action"
          icon="square-pen"
          iconClassName="claudian-conversation-header-icon"
          label={t('chat.header.newConversation')}
          onClick={onNewConversation}
        />
        {isConversationMenuOpen && (
          <div
            className="claudian-conversation-actions-menu"
            role="menu"
          >
            {onRenameConversation && (
              <button
                className="claudian-conversation-menu-item"
                type="button"
                role="menuitem"
                aria-label={t('chat.history.rename')}
                onClick={() => {
                  setIsConversationMenuOpen(false);
                  onRenameConversation();
                }}
              >
                <span
                  className="claudian-conversation-menu-item-icon"
                  aria-hidden="true"
                  ref={element => {
                    if (element) setIcon(element, 'pencil');
                  }}
                />
                <span>{t('chat.history.rename')}</span>
              </button>
            )}
            {onArchiveConversation && (
              <button
                className="claudian-conversation-menu-item"
                type="button"
                role="menuitem"
                aria-label={t('chat.history.archive')}
                disabled={isRunning}
                onClick={() => {
                  setIsConversationMenuOpen(false);
                  onArchiveConversation();
                }}
              >
                <span
                  className="claudian-conversation-menu-item-icon"
                  aria-hidden="true"
                  ref={element => {
                    if (element) setIcon(element, 'archive');
                  }}
                />
                <span>{t('chat.history.archive')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
