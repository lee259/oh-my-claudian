/** @jest-environment jsdom */

import '@/providers';

import type { ProviderId } from '@/core/types';
import {
  createWelcomeElement,
  refreshWelcomeContent,
  renderWelcomeContent,
} from '@/features/chat/rendering/WelcomeRenderer';

const PROVIDER_SUMMARY = {
  displayName: 'Codex',
  capabilities: {
    providerId: 'codex' as const,
    supportsNativeHistory: false,
    supportsPlanMode: true,
    supportsRewind: false,
    supportsFork: true,
    supportsProviderCommands: false,
    supportsImageAttachments: true,
    supportsInstructionMode: false,
    supportsMcpTools: false,
    supportsTurnSteer: false,
    reasoningControl: 'none' as const,
  },
};

describe('Welcome', () => {
  it('keeps recent conversations visible when a historical provider is no longer registered', () => {
    const parentEl = document.createElement('div');
    const welcomeEl = createWelcomeElement(parentEl, undefined, undefined, {
      getConversations: () => ['claude', 'dsh', 'codex'].map(providerId => ({
        id: providerId,
        providerId: providerId as ProviderId,
        title: `${providerId} conversation`,
        createdAt: 1000,
        lastActivityAt: 1000,
        messageCount: 1,
        preview: '',
      })),
    });

    expect(welcomeEl.querySelectorAll('.claudian-home-conversation')).toHaveLength(3);
    expect(welcomeEl.querySelectorAll('.claudian-home-conversation-provider')).toHaveLength(2);
    expect(welcomeEl.querySelectorAll('.claudian-home-conversation-title')[1]?.textContent)
      .toBe('dsh conversation');
  });

  it('renders Oh My Claudian branding before the dynamic greeting', () => {
    const parentEl = document.createElement('div');

    const welcomeEl = createWelcomeElement(parentEl, 'Good morning');

    expect(welcomeEl.classList.contains('claudian-welcome')).toBe(true);
    expect(welcomeEl.children).toHaveLength(2);
    expect(welcomeEl.children[0].classList.contains('claudian-welcome-brand')).toBe(true);
    expect(welcomeEl.children[0].classList.contains('claudian-welcome-text')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Oh My Claudian');
    expect(welcomeEl.children[1].classList.contains('claudian-welcome-greeting')).toBe(true);
    expect(welcomeEl.children[1].classList.contains('claudian-welcome-text')).toBe(true);
    expect(welcomeEl.children[1].textContent).toBe('Good morning');
  });

  it('replaces existing welcome content instead of duplicating branding', () => {
    const welcomeEl = document.createElement('div');

    renderWelcomeContent(welcomeEl, 'Hello');
    renderWelcomeContent(welcomeEl, 'Welcome back');

    expect(welcomeEl.children).toHaveLength(2);
    expect(welcomeEl.querySelectorAll('.claudian-welcome-brand')).toHaveLength(1);
    expect(welcomeEl.querySelector('.claudian-welcome-greeting')?.textContent)
      .toBe('Welcome back');
  });

  it('can render the brand before a greeting is available', () => {
    const parentEl = document.createElement('div');

    const welcomeEl = createWelcomeElement(parentEl);

    expect(welcomeEl.children).toHaveLength(1);
    expect(welcomeEl.children[0].textContent).toBe('Oh My Claudian');
  });

  it('explains the current provider capabilities on an empty conversation', () => {
    const parentEl = document.createElement('div');

    const welcomeEl = createWelcomeElement(parentEl, undefined, PROVIDER_SUMMARY);

    expect(welcomeEl.querySelector('.claudian-welcome-provider-name')?.textContent).toBe('Codex');
    expect(welcomeEl.querySelector('.claudian-welcome-capability-line--supported')?.textContent)
      .toContain('Plan mode · Fork · Image attachments');
    expect(welcomeEl.querySelector('.claudian-welcome-capability-line--unsupported')?.textContent)
      .toContain('Rewind · Provider commands · MCP tools · Turn steering');
  });

  it('renders the recent-conversation home surface from a lazy provider', () => {
    const parentEl = document.createElement('div');
    const onOpenConversation = jest.fn();
    const now = Date.now();
    const conversations = [
      {
        id: 'older',
        providerId: 'codex' as const,
        title: 'Older conversation',
        createdAt: 1,
        lastActivityAt: 1,
        messageCount: 1,
        preview: '',
        isArchived: false,
      },
      {
        id: 'recent',
        providerId: 'codex' as const,
        title: 'Recent conversation',
        createdAt: 2,
        lastActivityAt: now,
        messageCount: 1,
        preview: '',
        isArchived: false,
        titleGenerationStatus: 'pending' as const,
      },
    ];
    const onArchiveConversation = jest.fn((conversationId: string) => {
      const conversation = conversations.find(item => item.id === conversationId);
      if (conversation) conversation.isArchived = true;
    });

    const welcomeEl = createWelcomeElement(parentEl, 'Good morning', undefined, {
      getConversations: () => conversations,
      onOpenConversation,
      onArchiveConversation,
    });

    expect(welcomeEl.hasClass('claudian-welcome--home')).toBe(true);
    expect(welcomeEl.querySelector('.claudian-home-header')).toBeNull();
    expect(welcomeEl.querySelector('.claudian-home-greeting')?.textContent).toBe('Good morning');
    const recent = welcomeEl.querySelector('.claudian-home-conversation');
    expect(recent?.querySelector('.claudian-home-conversation-title')?.textContent)
      .toBe('Recent conversation');
    const providerLogo = recent?.querySelector<HTMLElement>('.claudian-home-conversation-provider');
    expect(providerLogo?.getAttribute('aria-label')).toBe('Codex');
    expect(providerLogo?.getAttribute('title')).toBe('Codex');
    expect(providerLogo?.querySelector('svg')?.getAttribute('data-provider')).toBe('codex');
    expect(recent?.querySelector('.claudian-home-conversation-time')?.textContent)
      .toBe(new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(0, 'second'));
    expect(recent?.querySelector('.claudian-home-conversation-loading'))
      .toBeTruthy();
    expect(recent?.querySelector('.claudian-home-conversation-loading')?.getAttribute('aria-label'))
      .toBe('Generating title...');

    providerLogo?.click();
    expect(onOpenConversation).toHaveBeenCalledWith('recent');

    const archiveButton = recent?.querySelector<HTMLElement>('.claudian-home-conversation-archive');
    expect(archiveButton?.getAttribute('aria-label')).toBe('Archive');
    archiveButton?.click();
    expect(onArchiveConversation).toHaveBeenCalledWith('recent');
    expect(onOpenConversation).toHaveBeenCalledTimes(1);
    refreshWelcomeContent(welcomeEl);
    expect(welcomeEl.querySelector('.claudian-home-conversation-title')?.textContent)
      .toBe('Older conversation');
  });

  it('removes the title spinner when lazy conversation status finishes', () => {
    const parentEl = document.createElement('div');
    const conversations = [{
      id: 'recent',
      providerId: 'codex' as const,
      title: 'Recent conversation',
      createdAt: 2,
      lastActivityAt: Date.now(),
      messageCount: 1,
      preview: '',
      isArchived: false,
      titleGenerationStatus: 'pending' as 'pending' | undefined,
    }];
    const welcomeEl = createWelcomeElement(parentEl, undefined, undefined, {
      getConversations: () => conversations,
    });

    expect(welcomeEl.querySelector('.claudian-home-conversation-loading')).not.toBeNull();

    conversations[0].titleGenerationStatus = undefined;
    refreshWelcomeContent(welcomeEl);

    expect(welcomeEl.querySelector('.claudian-home-conversation-loading')).toBeNull();
  });

  it('uses live session status rather than title generation status for home loading', () => {
    const parentEl = document.createElement('div');
    const conversations = [{
      id: 'recent',
      providerId: 'codex' as const,
      title: 'Recent conversation',
      createdAt: 2,
      lastActivityAt: Date.now(),
      messageCount: 1,
      preview: '',
      isArchived: false,
      titleGenerationStatus: 'pending' as const,
    }];
    let isRunning = false;
    const welcomeEl = createWelcomeElement(parentEl, undefined, undefined, {
      getConversations: () => conversations,
      isConversationRunning: () => isRunning,
    } as any);

    expect(welcomeEl.querySelector('.claudian-home-conversation-loading')).toBeNull();

    isRunning = true;
    refreshWelcomeContent(welcomeEl);
    expect(welcomeEl.querySelector('.claudian-home-conversation-loading')).not.toBeNull();

    isRunning = false;
    refreshWelcomeContent(welcomeEl);
    expect(welcomeEl.querySelector('.claudian-home-conversation-loading')).toBeNull();
  });

  it('formats recent activity with minute and hour granularity', () => {
    const parentEl = document.createElement('div');
    const now = Date.now();
    const welcomeEl = createWelcomeElement(parentEl, undefined, undefined, {
      getConversations: () => [
        {
          id: 'minutes-ago',
          providerId: 'codex',
          title: 'Minutes ago',
          createdAt: 1,
          lastActivityAt: now - (5 * 60_000),
          messageCount: 1,
          preview: '',
        },
        {
          id: 'hours-ago',
          providerId: 'codex',
          title: 'Hours ago',
          createdAt: 2,
          lastActivityAt: now - (2 * 3_600_000),
          messageCount: 1,
          preview: '',
        },
        {
          id: 'days-ago',
          providerId: 'codex',
          title: 'Days ago',
          createdAt: 3,
          lastActivityAt: now - (2 * 86_400_000),
          messageCount: 1,
          preview: '',
        },
      ],
    });

    const times = [...welcomeEl.querySelectorAll('.claudian-home-conversation-time')]
      .map(element => element.textContent);
    expect(times).toEqual([
      '5m',
      '2h',
      '2d',
    ]);
  });
});
