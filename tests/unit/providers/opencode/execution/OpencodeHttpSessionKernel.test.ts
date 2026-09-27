const mockRequest = jest.fn();
const mockSubscribe = jest.fn();
const mockWaitForActivation = jest.fn();
const mockDispose = jest.fn();
const mockClientConstructor = jest.fn();
let onEvent: ((event: { type: string; data: Record<string, unknown> }) => void) | null = null;

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
    onEvent = null;
    mockSubscribe.mockImplementation(async (handler: typeof onEvent) => {
      onEvent = handler;
    });
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
      if (route === '/api/agent') return { data: [
        { mode: 'primary', name: 'Build' },
        { mode: 'primary', name: 'Plan' },
      ] };
      if (route === '/api/session') return { data: { id: 'ses_test' } };
      return undefined;
    });
  });

  it('switches the active v2 session to the selected native agent before prompting', async () => {
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

    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    expect(session.modes).toEqual({
      availableModes: [
        { id: 'build', name: 'Build' },
        { id: 'plan', name: 'Plan' },
      ],
      currentModeId: 'build',
    });
    await kernel.setConfigOption({ configId: 'mode', sessionId: session.sessionId, value: 'Plan' });

    const prompt = kernel.prompt({
      sessionId: session.sessionId,
      prompt: [{ text: 'Plan this change', type: 'text' }],
    } as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRequest).toHaveBeenCalledWith('/api/session/ses_test/agent', {
      method: 'POST',
      body: { agent: 'plan' },
    });
    expect(mockRequest).toHaveBeenCalledWith('/api/session/ses_test/prompt', expect.objectContaining({
      body: expect.not.objectContaining({ agent: expect.anything() }),
    }));
    onEvent?.({ type: 'session.execution.started', data: { sessionID: 'ses_test' } });
    onEvent?.({ type: 'session.execution.succeeded', data: { sessionID: 'ses_test' } });
    await prompt;
    await kernel.dispose();
  });

  it('keeps multiple native steps in one assistant message boundary per prompt', async () => {
    const onNativeOutput = jest.fn();
    const kernel = new OpencodeHttpSessionKernel({
      config: {
        vaultWorkingDirectory: '/vault',
        interactionPort: { dismissInteraction: jest.fn() },
      } as any,
      getActiveTurnId: () => 'turn_test',
      onClosed: jest.fn(),
      onNativeOutput,
      onNotification: jest.fn(),
      plugin: {
        settings: {},
        getResolvedProviderCliPath: jest.fn(),
        mutateSettings: jest.fn(),
      } as any,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});

    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    const prompt = kernel.prompt({
      sessionId: session.sessionId,
      prompt: [{ text: 'Read a file, then answer', type: 'text' }],
    } as any);
    await Promise.resolve();
    await Promise.resolve();

    onEvent?.({ type: 'session.execution.started', data: { sessionID: 'ses_test' } });
    onEvent?.({ type: 'session.step.started', data: { sessionID: 'ses_test', assistantMessageID: 'msg_tool' } });
    onEvent?.({ type: 'session.step.started', data: { sessionID: 'ses_test', assistantMessageID: 'msg_final' } });

    expect(onNativeOutput.mock.calls.filter(([event]) => event.type === 'assistant_message_started'))
      .toHaveLength(1);

    onEvent?.({ type: 'session.execution.succeeded', data: { sessionID: 'ses_test' } });
    await expect(prompt).resolves.toMatchObject({ nativeAssistantId: 'msg_final' });
    await kernel.dispose();
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
