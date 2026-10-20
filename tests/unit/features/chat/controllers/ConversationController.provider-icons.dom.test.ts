/** @jest-environment jsdom */

import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ConversationMeta, ProviderId } from '@/core/types';
import { ConversationController, type ConversationControllerDeps } from '@/features/chat/controllers/ConversationController';
import { ChatState } from '@/features/chat/state/ChatState';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};

function createHarness(conversations: ConversationMeta[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const controller = new ConversationController({
    plugin: { getConversationList: () => conversations },
    state: new ChatState(),
    getMessagesEl: () => null,
  } as unknown as ConversationControllerDeps);
  const onSelectConversation = jest.fn();
  const render = () => controller.renderHistoryDropdown(container, {
    onSelectConversation,
    preserveListState: true,
    sessionActionMode: 'mixed',
    getConversationStatus: () => ({ openState: 'closed', isRunning: true }),
  });
  return { container, onSelectConversation, render };
}

function conversation(providerId: ProviderId): ConversationMeta {
  return {
    id: providerId,
    providerId,
    title: `${providerId} conversation`,
    createdAt: 1000,
    lastActivityAt: 1000,
    messageCount: 1,
    preview: '',
    isArchived: providerId === 'omp',
  };
}

describe('ConversationController history provider icons', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.replaceChildren();
  });

  it.each<ProviderId>(['claude', 'codex', 'cursor', 'grok', 'omp', 'opencode', 'pi'])(
    'renders the %s model-selector logo with an accessible name and keeps it clickable',
    async providerId => {
      const { container, onSelectConversation, render } = createHarness([conversation(providerId)]);
      render();

      const icon = container.querySelector<HTMLElement>('.claudian-history-item-provider')!;
      expect(icon).not.toBeNull();
      expect(icon.getAttribute('role')).toBe('img');
      expect(icon.getAttribute('aria-label')).toBe(ProviderRegistry.getProviderDisplayName(providerId));
      expect(icon.getAttribute('title')).toBe(ProviderRegistry.getProviderDisplayName(providerId));
      const svg = icon.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe(
        ProviderRegistry.getChatUIConfig(providerId).getProviderIcon!()!.viewBox,
      );
      expect(svg.getAttribute('data-provider')).toBe(providerId);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(icon.closest('.claudian-history-item-content')
        ?.querySelector('.claudian-history-item-title')?.textContent).toBe(`${providerId} conversation`);
      expect(container.querySelector('.claudian-history-item-icon')).not.toBeNull();
      expect(container.querySelector('.claudian-history-item')?.getAttribute('data-running')).toBe('true');

      icon.click();
      await Promise.resolve();
      expect(onSelectConversation).toHaveBeenCalledWith(providerId);
    },
  );

  it('refreshes the logo when provider metadata changes during a preserved render', () => {
    const metadata = conversation('claude');
    const { container, render } = createHarness([metadata]);
    render();
    const originalRenderKey = container.querySelector('.claudian-history-item')
      ?.getAttribute('data-history-render-key');

    metadata.providerId = 'codex';
    render();

    expect(container.querySelector('.claudian-history-item')?.getAttribute('data-history-render-key'))
      .not.toBe(originalRenderKey);
    expect(container.querySelector('.claudian-history-item-provider')?.getAttribute('aria-label'))
      .toBe('Codex');
  });

  it('keeps the title usable when a provider has no logo', () => {
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({} as never);
    const { container, render } = createHarness([conversation('codex')]);
    render();

    expect(container.querySelector('.claudian-history-item-provider')).toBeNull();
    expect(container.querySelector('.claudian-history-item-title')?.textContent)
      .toBe('codex conversation');
  });

  it('keeps mixed history visible when a historical provider is no longer registered', () => {
    const { container, render } = createHarness([
      conversation('claude'),
      conversation('dsh' as ProviderId),
      conversation('codex'),
    ]);

    expect(render).not.toThrow();
    expect(container.querySelectorAll('.claudian-history-item')).toHaveLength(3);
    expect(container.querySelectorAll('.claudian-history-item-provider')).toHaveLength(2);
    expect(container.querySelector('[data-conversation-id="dsh"] .claudian-history-item-title')?.textContent)
      .toBe('dsh conversation');
    expect(container.querySelector('.claudian-history-render-staging')).toBeNull();
  });
});
