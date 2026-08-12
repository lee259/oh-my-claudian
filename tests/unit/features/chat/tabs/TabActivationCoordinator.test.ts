import { activateTabContent } from '@/features/chat/tabs/TabActivationCoordinator';

function createTab(overrides: Record<string, unknown> = {}): any {
  return {
    conversationId: null,
    hydrationState: 'idle',
    state: { messages: [] },
    controllers: {
      conversationController: {
        initializeWelcome: jest.fn(),
        switchTo: jest.fn().mockResolvedValue(undefined),
      },
    },
    ...overrides,
  };
}

describe('activateTabContent', () => {
  it('initializes an empty tab after workspace services are ready', async () => {
    const tab = createTab();
    const ensureWorkspaceServices = jest.fn().mockResolvedValue(true);

    const result = await activateTabContent({
      tab,
      ensureWorkspaceServices,
      isTabAlive: () => true,
      renderHydrationState: jest.fn(),
      waitForPaint: jest.fn().mockResolvedValue(undefined),
      startHydrationProfile: () => null,
    });

    expect(result).toEqual({ status: 'activated' });
    expect(ensureWorkspaceServices).toHaveBeenCalledTimes(1);
    expect(tab.controllers.conversationController.initializeWelcome).toHaveBeenCalledTimes(1);
    expect(tab.hydrationState).toBe('ready');
  });

  it('hydrates a conversation only after the paint boundary', async () => {
    const tab = createTab({ conversationId: 'conversation-1' });
    const events: string[] = [];
    tab.controllers.conversationController.switchTo.mockImplementation(async () => {
      events.push('switch');
    });

    const result = await activateTabContent({
      tab,
      ensureWorkspaceServices: jest.fn().mockResolvedValue(true),
      isTabAlive: () => true,
      renderHydrationState: () => events.push('render-loading'),
      waitForPaint: async () => {
        events.push('paint');
      },
      startHydrationProfile: () => ({ finish: () => events.push('profile-finished') }),
    });

    expect(result).toEqual({ status: 'activated' });
    expect(events).toEqual(['render-loading', 'paint', 'switch', 'profile-finished']);
    expect(tab.hydrationState).toBe('ready');
  });

  it('reports hydration errors and leaves the tab retryable', async () => {
    const tab = createTab({ conversationId: 'conversation-1' });
    const error = new Error('load failed');
    tab.controllers.conversationController.switchTo.mockRejectedValue(error);
    const renderHydrationState = jest.fn();

    const result = await activateTabContent({
      tab,
      ensureWorkspaceServices: jest.fn().mockResolvedValue(true),
      isTabAlive: () => true,
      renderHydrationState,
      waitForPaint: jest.fn().mockResolvedValue(undefined),
      startHydrationProfile: () => null,
    });

    expect(result).toEqual({ status: 'failed', error });
    expect(tab.hydrationState).toBe('failed');
    expect(renderHydrationState).toHaveBeenLastCalledWith(error);
  });
});
