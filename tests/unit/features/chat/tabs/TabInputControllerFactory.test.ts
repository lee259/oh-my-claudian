import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { InputController } from '@/features/chat/controllers/InputController';
import {
  createTabInputController,
  type TabInputControllerOptions,
} from '@/features/chat/tabs/TabInputControllerFactory';
import type { TabData } from '@/features/chat/tabs/types';
import type { FeatureHost } from '@/features/FeatureHost';

jest.mock('@/features/chat/controllers/InputController', () => ({
  InputController: jest.fn(),
}));

jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    collectDiagnostics: jest.fn(),
    getCliLifecycleAdapter: jest.fn(),
  },
}));

function createFixture(providerId: 'antigravity' | 'claude') {
  const check = jest.fn().mockResolvedValue({ checkedAt: 0, status: 'ready' });
  const tab = {
    conversationId: null,
    controllers: {},
    draftModel: undefined,
    providerId,
    services: {},
    session: {
      composer: {},
      messagePresentation: { messagesElement: null },
    },
    state: {},
    ui: { quotedMessages: [] },
  } as unknown as TabData;
  const plugin = {
    getConversationSync: jest.fn(),
    providerHost: {
      cliLifecycle: { check },
      getResolvedProviderCliPath: jest.fn(),
    },
    settings: {},
  } as unknown as FeatureHost;
  const options: TabInputControllerOptions = {
    ensureExecutionInitialized: jest.fn().mockResolvedValue(true),
    generateId: jest.fn(),
    getAuxiliaryModel: () => null,
    getProviderSettings: () => ({}),
    onDiagnosticError: jest.fn(),
    restorePrePlanPermissionModeIfNeeded: jest.fn(),
    toggleFastMode: jest.fn(),
  };

  createTabInputController(tab, plugin, options);
  const deps = jest.mocked(InputController).mock.calls.at(-1)?.[0];
  if (!deps?.preflightExecution) throw new Error('Missing preflight execution dependency');
  return { check, preflightExecution: deps.preflightExecution };
}

describe('TabInputControllerFactory preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ProviderRegistry.collectDiagnostics).mockResolvedValue(null);
  });

  it('skips CLI lifecycle checks for providers without an adapter', async () => {
    jest.mocked(ProviderRegistry.getCliLifecycleAdapter).mockReturnValue(null);
    const { check, preflightExecution } = createFixture('antigravity');

    await expect(preflightExecution()).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('still checks installed CLI readiness when the provider has an adapter', async () => {
    jest.mocked(ProviderRegistry.getCliLifecycleAdapter).mockReturnValue({} as never);
    const { check, preflightExecution } = createFixture('claude');

    await expect(preflightExecution()).resolves.toBeNull();
    expect(check).toHaveBeenCalledWith('claude', { includeLatestVersion: false });
  });
});
