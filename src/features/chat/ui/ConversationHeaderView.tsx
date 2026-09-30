import { setIcon } from 'obsidian';
import { useEffect, useRef, useState } from 'preact/hooks';

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

  useEffect(() => {
    if (!isConversationMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!conversationMenuAnchorRef.current?.contains(event.target as Node)) {
        setIsConversationMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsConversationMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isConversationMenuOpen]);

  const openConversationMenu = (event: MouseEvent): void => {
    event.stopPropagation();
    setIsConversationMenuOpen(open => !open);
  };

  if (isHome) {
    return (
      <header className="claudian-conversation-header claudian-conversation-header--home">
        <div className="claudian-home-title">{t('chat.home.title')}</div>
        <div className="claudian-home-actions">
          <IconButton
            className="claudian-home-action"
            icon="history"
            label={t('chat.home.history')}
            onClick={onOpenHistory}
          />
          <IconButton
            className="claudian-home-action"
            icon="settings"
            label={t('chat.home.settings')}
            onClick={onOpenSettings}
          />
          <IconButton
            className="claudian-home-action"
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
