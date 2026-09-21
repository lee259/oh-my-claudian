import { t } from '../../../i18n/i18n';
import { IconButton } from '../../../shared/ui/IconButton';

export interface ConversationHeaderViewProps {
  title: string;
  onBack?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onNewConversation?: () => void;
}

export function ConversationHeaderView({
  title,
  onBack,
  onOpenHistory,
  onOpenSettings,
  onNewConversation,
}: ConversationHeaderViewProps) {
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
