import { setIcon } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ConversationMeta } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { IconButton } from '../../../shared/ui/IconButton';
import { formatActivity } from '../utils/formatActivity';

const WELCOME_BRAND_NAME = 'Oh My Claudian';

type WelcomeCapabilityKey = keyof Pick<
  ProviderCapabilities,
  | 'supportsPlanMode'
  | 'supportsRewind'
  | 'supportsFork'
  | 'supportsProviderCommands'
  | 'supportsImageAttachments'
  | 'supportsMcpTools'
  | 'supportsTurnSteer'
>;

const WELCOME_CAPABILITIES: ReadonlyArray<{
  key: WelcomeCapabilityKey;
  label: 'settings.capabilityMatrix.rows.planMode'
    | 'settings.capabilityMatrix.rows.rewind'
    | 'settings.capabilityMatrix.rows.fork'
    | 'settings.capabilityMatrix.rows.providerCommands'
    | 'settings.capabilityMatrix.rows.imageAttachments'
    | 'settings.capabilityMatrix.rows.mcpTools'
    | 'settings.capabilityMatrix.rows.turnSteer';
}> = [
  { key: 'supportsPlanMode', label: 'settings.capabilityMatrix.rows.planMode' },
  { key: 'supportsRewind', label: 'settings.capabilityMatrix.rows.rewind' },
  { key: 'supportsFork', label: 'settings.capabilityMatrix.rows.fork' },
  { key: 'supportsProviderCommands', label: 'settings.capabilityMatrix.rows.providerCommands' },
  { key: 'supportsImageAttachments', label: 'settings.capabilityMatrix.rows.imageAttachments' },
  { key: 'supportsMcpTools', label: 'settings.capabilityMatrix.rows.mcpTools' },
  { key: 'supportsTurnSteer', label: 'settings.capabilityMatrix.rows.turnSteer' },
];

export interface WelcomeProviderSummary {
  displayName: string;
  capabilities: ProviderCapabilities;
}

export interface WelcomeHomeOptions {
  getConversations: () => readonly ConversationMeta[];
  onArchiveConversation?: (conversationId: string) => void;
  onBack?: () => void;
  onOpenConversation?: (conversationId: string) => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onNewConversation?: () => void;
}

function HomeConversationLoadingIndicator() {
  return (
    <span
      className="claudian-home-conversation-loading"
      aria-label={t('chat.history.generatingTitle')}
      ref={(element) => {
        if (element) setIcon(element, 'loader-2');
      }}
    />
  );
}

function HomeConversationArchiveAction({
  conversationId,
  onArchive,
}: {
  conversationId: string;
  onArchive?: (conversationId: string) => void;
}) {
  return (
    <IconButton
      className="claudian-home-conversation-archive"
      icon="archive"
      label={t('chat.history.archive')}
      onClick={() => onArchive?.(conversationId)}
    />
  );
}

function CapabilitySummary({ providerSummary }: { providerSummary: WelcomeProviderSummary }) {
  const supported = WELCOME_CAPABILITIES
    .filter(({ key }) => providerSummary.capabilities[key])
    .map(({ label }) => t(label));
  const unsupported = WELCOME_CAPABILITIES
    .filter(({ key }) => !providerSummary.capabilities[key])
    .map(({ label }) => t(label));

  return (
    <div className="claudian-welcome-capability-summary">
      <div className="claudian-welcome-provider-name">{providerSummary.displayName}</div>
      <div className="claudian-welcome-capability-line claudian-welcome-capability-line--supported">
        {t('chat.welcome.availableCapabilities', { capabilities: supported.join(' · ') })}
      </div>
      {unsupported.length > 0 && (
        <div className="claudian-welcome-capability-line claudian-welcome-capability-line--unsupported">
          {t('chat.welcome.unavailableCapabilities', { capabilities: unsupported.join(' · ') })}
        </div>
      )}
    </div>
  );
}

function HomeSurface({ greeting, options }: { greeting?: string; options: WelcomeHomeOptions }) {
  const conversations = [...options.getConversations()]
    .filter(conversation => !conversation.isArchived)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  return (
    <>
      <div className="claudian-home-header">
        <div className="claudian-home-title">{t('chat.home.title')}</div>
        <div className="claudian-home-actions">
          <IconButton
            className="claudian-home-action"
            icon="history"
            label={t('chat.home.history')}
            onClick={options.onOpenHistory}
          />
          <IconButton
            className="claudian-home-action"
            icon="settings"
            label={t('chat.home.settings')}
            onClick={options.onOpenSettings}
          />
          <IconButton
            className="claudian-home-action"
            icon="square-pen"
            label={t('chat.home.newConversation')}
            onClick={options.onNewConversation}
          />
        </div>
      </div>
      <div className="claudian-home-recent">
        {conversations.slice(0, 3).map((conversation) => (
          <div
            key={conversation.id}
            className="claudian-home-conversation"
          >
            <button
              className="claudian-home-conversation-open"
              type="button"
              aria-label={conversation.title}
              onClick={(event) => {
                event.stopPropagation();
                options.onOpenConversation?.(conversation.id);
              }}
            >
              <span className="claudian-home-conversation-title">{conversation.title}</span>
              <span className="claudian-home-conversation-time">
                {formatActivity(conversation.lastActivityAt)}
              </span>
              {conversation.titleGenerationStatus === 'pending' && (
                <HomeConversationLoadingIndicator />
              )}
            </button>
            {options.onArchiveConversation && (
              <HomeConversationArchiveAction
                conversationId={conversation.id}
                onArchive={options.onArchiveConversation}
              />
            )}
          </div>
        ))}
        <button
          className="claudian-home-all-conversations"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            options.onOpenHistory?.();
          }}
        >
          {t('chat.home.viewAll', { count: conversations.length })}
        </button>
      </div>
      <div className="claudian-home-center">
        {greeting && <div className="claudian-home-greeting">{greeting}</div>}
      </div>
    </>
  );
}

export interface WelcomeViewProps {
  greeting?: string;
  providerSummary?: WelcomeProviderSummary;
  homeOptions?: WelcomeHomeOptions;
}

export function WelcomeView({ greeting, providerSummary, homeOptions }: WelcomeViewProps) {
  if (homeOptions) {
    return <HomeSurface greeting={greeting} options={homeOptions} />;
  }

  return (
    <>
      <div className="claudian-welcome-brand claudian-welcome-text">{WELCOME_BRAND_NAME}</div>
      {greeting && (
        <div className="claudian-welcome-greeting claudian-welcome-text">{greeting}</div>
      )}
      {providerSummary && <CapabilitySummary providerSummary={providerSummary} />}
    </>
  );
}
