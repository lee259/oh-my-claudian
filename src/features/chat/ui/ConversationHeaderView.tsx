import { t } from '../../../i18n/i18n';
import { IconButton } from '../../../shared/ui/IconButton';

export interface ConversationHeaderViewProps {
  title: string;
  isHome?: boolean;
  onBack?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onNewConversation?: () => void;
}

export function ConversationHeaderView({
  title,
  isHome = false,
  onBack,
  onOpenHistory,
  onOpenSettings,
  onNewConversation,
}: ConversationHeaderViewProps) {
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
        <div className="claudian-conversation-header-title">
          {title}
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
