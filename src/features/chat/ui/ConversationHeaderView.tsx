import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';

export interface ConversationHeaderViewProps {
  title: string;
  onBack?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onNewConversation?: () => void;
}

interface HeaderIconButtonProps {
  icon: string;
  label: string;
  onClick?: () => void;
}

function HeaderIconButton({
  icon,
  label,
  onClick,
}: HeaderIconButtonProps) {
  return (
    <button
      className="claudian-conversation-header-action"
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <span
        className="claudian-conversation-header-icon"
        aria-hidden="true"
        ref={(element) => {
          if (element) setIcon(element, icon);
        }}
      />
    </button>
  );
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
        <HeaderIconButton
          icon="arrow-left"
          label={t('chat.header.back')}
          onClick={onBack}
        />
        <div className="claudian-conversation-header-title">
          {title}
        </div>
      </div>
      <div className="claudian-conversation-header-actions">
        <HeaderIconButton
          icon="history"
          label={t('chat.header.history')}
          onClick={onOpenHistory}
        />
        <HeaderIconButton
          icon="settings"
          label={t('chat.header.settings')}
          onClick={onOpenSettings}
        />
        <HeaderIconButton
          icon="square-pen"
          label={t('chat.header.newConversation')}
          onClick={onNewConversation}
        />
      </div>
    </header>
  );
}
