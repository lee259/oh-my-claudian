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
  onRenameConversation?: (title: string) => void;
}

export function ConversationHeaderView({
  title,
  isHome = false,
  onBack,
  onOpenHistory,
  onOpenSettings,
  onNewConversation,
  onRenameConversation,
}: ConversationHeaderViewProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const isRenamingRef = useRef(false);

  useEffect(() => {
    if (!isRenaming) setDraftTitle(title);
  }, [isRenaming, title]);

  useEffect(() => {
    if (!isRenaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  const cancelRename = (): void => {
    isRenamingRef.current = false;
    setDraftTitle(title);
    setIsRenaming(false);
  };

  const saveRename = (): void => {
    if (!isRenamingRef.current) return;
    isRenamingRef.current = false;
    setIsRenaming(false);
    const nextTitle = (inputRef.current?.value ?? draftTitle).trim();
    if (nextTitle && nextTitle !== title) onRenameConversation?.(nextTitle);
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
          {isRenaming ? (
            <input
              ref={inputRef}
              className="claudian-conversation-header-rename-input"
              aria-label={t('chat.history.rename')}
              value={draftTitle}
              onInput={(event) => setDraftTitle(event.currentTarget.value)}
              onBlur={saveRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.isComposing) {
                  event.preventDefault();
                  saveRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <div className="claudian-conversation-header-title">
              {title}
            </div>
          )}
          {!isRenaming && onRenameConversation && (
            <IconButton
              className="claudian-conversation-header-action claudian-conversation-header-rename-action"
              icon="pencil"
              iconClassName="claudian-conversation-header-icon"
              label={t('chat.history.rename')}
              onClick={() => {
                isRenamingRef.current = true;
                setDraftTitle(title);
                setIsRenaming(true);
              }}
            />
          )}
        </div>
      </div>
      <div className="claudian-conversation-header-actions">
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
      </div>
    </header>
  );
}
