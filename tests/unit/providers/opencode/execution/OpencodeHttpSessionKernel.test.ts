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
  let emitEvent: ((event: { type: string; data: Record<string, unknown> }) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    emitEvent = undefined;
    mockSubscribe.mockImplementation(async (onEvent: typeof emitEvent) => { emitEvent = onEvent; });
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
    emitEvent?.({ type: 'session.execution.started', data: { sessionID: 'ses_test' } });
    emitEvent?.({ type: 'session.execution.succeeded', data: { sessionID: 'ses_test' } });
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

    emitEvent?.({ type: 'session.execution.started', data: { sessionID: 'ses_test' } });
    emitEvent?.({ type: 'session.step.started', data: { sessionID: 'ses_test', assistantMessageID: 'msg_tool' } });
    emitEvent?.({ type: 'session.step.started', data: { sessionID: 'ses_test', assistantMessageID: 'msg_final' } });

    expect(onNativeOutput.mock.calls.filter(([event]) => event.type === 'assistant_message_started'))
      .toHaveLength(1);

    emitEvent?.({ type: 'session.execution.succeeded', data: { sessionID: 'ses_test' } });
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

  it('accepts a steer only after the native inbox delivers it and keeps prompt boundaries ordered', async () => {
    const outputs: Array<Record<string, unknown>> = [];
    const kernel = new OpencodeHttpSessionKernel({
      config: { vaultWorkingDirectory: '/vault', interactionPort: { dismissInteraction: jest.fn() } } as any,
      getActiveTurnId: () => 'turn_test', onClosed: jest.fn(), onNotification: jest.fn(),
      onNativeOutput: event => outputs.push(event as unknown as Record<string, unknown>),
      plugin: { settings: {}, getResolvedProviderCliPath: jest.fn(), mutateSettings: jest.fn() } as any,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});

    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    const prompt = kernel.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Review this' }] } as any);
    await Promise.resolve();
    await Promise.resolve();
    const steer = kernel.steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Also check tests' }] } as any);
    await Promise.resolve();
    await Promise.resolve();
    const steerRequest = mockRequest.mock.calls.find(([, options]) => options?.body?.delivery === 'steer');
    expect(steerRequest).toBeDefined();
    const inboxId = steerRequest[1].body.id;

    emitEvent?.({ type: 'session.execution.started', data: { sessionID: session.sessionId } });
    expect(outputs[0]).toMatchObject({ type: 'user_message_started' });
    emitEvent?.({ type: 'session.inbox.delivered', data: { sessionID: session.sessionId, inboxID: inboxId } });
    await expect(steer).resolves.toBe(true);
    expect(outputs[1]).toMatchObject({ type: 'user_message_started', content: 'Also check tests', nativeUserMessageId: inboxId });
    emitEvent?.({ type: 'session.execution.succeeded', data: { sessionID: session.sessionId } });
    await expect(prompt).resolves.toMatchObject({ stopReason: 'end_turn' });
    await kernel.dispose();
  });

  it('recalls an undelivered steer when the native turn is interrupted', async () => {
    const kernel = new OpencodeHttpSessionKernel({
      config: { vaultWorkingDirectory: '/vault', interactionPort: { dismissInteraction: jest.fn() } } as any,
      getActiveTurnId: () => 'turn_test', onClosed: jest.fn(), onNotification: jest.fn(),
      plugin: { settings: {}, getResolvedProviderCliPath: jest.fn(), mutateSettings: jest.fn() } as any,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});

    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    const prompt = kernel.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Review this' }] } as any);
    await Promise.resolve();
    await Promise.resolve();
    const steer = kernel.steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Also check tests' }] } as any);
    await Promise.resolve();
    await Promise.resolve();
    const steerRequest = mockRequest.mock.calls.find(([, options]) => options?.body?.delivery === 'steer');
    const inboxId = steerRequest[1].body.id;

    emitEvent?.({ type: 'session.execution.started', data: { sessionID: session.sessionId } });
    emitEvent?.({ type: 'session.execution.interrupted', data: { sessionID: session.sessionId } });
    await expect(prompt).resolves.toMatchObject({ stopReason: 'cancelled' });
    await expect(steer).resolves.toBe(false);
    expect(mockRequest).toHaveBeenCalledWith(
      `/api/session/${session.sessionId}/inbox/${inboxId}`,
      { method: 'DELETE' },
    );
    await kernel.dispose();
  });
});
