const mockRequest = jest.fn();
const mockSubscribe = jest.fn();
const mockWaitForActivation = jest.fn();
const mockDispose = jest.fn();
const mockClientConstructor = jest.fn();

jest.mock('@/providers/opencode/http/OpencodeHttpClient', () => ({
  OpencodeHttpClient: class {
    constructor(...args: unknown[]) {
      mockClientConstructor(...args);
    }

    request = mockRequest;
    subscribe = mockSubscribe;
    waitForActivation = mockWaitForActivation;
    dispose = mockDispose;
  },
  OpencodeHttpError: class extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
  isRecord: (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  ),
}));

jest.mock('@/providers/opencode/runtime/OpencodeLaunchArtifacts', () => ({
  prepareOpencodeLaunchArtifacts: jest.fn().mockResolvedValue({
    configPath: '/vault/.claudian/opencode/config.json',
    configContent: '{}',
    databasePath: '/vault/.claudian/opencode/opencode.db',
  }),
}));

import { OpencodeHttpSessionKernel } from '@/providers/opencode/execution/OpencodeHttpSessionKernel';

describe('OpencodeHttpSessionKernel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.mockImplementation(async (route: string) => {
      if (route === '/api/model') {
        return {
          data: [{
            enabled: true,
            id: 'mimo-v2.6-flash-free',
            name: 'MiMo-V2.6-Flash Free',
            providerID: 'opencode',
            variants: [],
          }],
        };
      }
      if (route === '/api/command') return { data: [] };
      if (route === '/api/session') return { data: { id: 'ses_test' } };
      return undefined;
    });
  });

  it('selects the exact native provider and model IDs for a v2 model', async () => {
    const plugin = {
      settings: {},
      getResolvedProviderCliPath: jest.fn(),
      mutateSettings: jest.fn(),
    } as any;
    const kernel = new OpencodeHttpSessionKernel({
      config: {
        vaultWorkingDirectory: '/vault',
        interactionPort: { dismissInteraction: jest.fn() },
      } as any,
      getActiveTurnId: () => 'turn_test',
      onClosed: jest.fn(),
      onNotification: jest.fn(),
      plugin,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});

    await kernel.connect({
      profile: 'managed',
      systemInstructions: { kind: 'none' },
    });
    const session = await kernel.openSession();
    await kernel.setConfigOption({
      configId: 'model',
      sessionId: session.sessionId,
      value: 'opencode/mimo-v2.6-flash-free',
    });

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/session/ses_test/model',
      {
        method: 'POST',
        body: {
          model: {
            providerID: 'opencode',
            id: 'mimo-v2.6-flash-free',
          },
        },
      },
    );
    await kernel.dispose();
  });
});
