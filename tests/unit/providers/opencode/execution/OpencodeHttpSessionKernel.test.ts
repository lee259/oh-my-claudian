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
      if (route === '/api/command') return { data: [{ name: 'init' }] };
      if (route === '/api/agent') return { data: [
        { mode: 'primary', name: 'Build' },
        { mode: 'primary', name: 'Plan' },
      ] };
      if (route === '/api/session') return { data: { id: 'ses_test' } };
      return undefined;
    });
  });

  it('resolves slash commands against the live v2 catalog', async () => {
    mockRequest.mockImplementation(async (route: string) => {
      if (route === '/api/model') return { data: [{ enabled: true, id: 'm', name: 'Model', providerID: 'test' }] };
      if (route === '/api/command') return { data: [{ name: 'review' }] };
      if (route === '/api/agent') return { data: [] };
      if (route === '/api/session') return { data: { id: 'ses_test' } };
      if (route === '/api/session/ses_test/message?order=desc&limit=1') return { data: [] };
      return undefined;
    });
    const kernel = new OpencodeHttpSessionKernel({
      config: { vaultWorkingDirectory: '/vault', interactionPort: { dismissInteraction: jest.fn() } } as any,
      getActiveTurnId: () => 'turn_test', onClosed: jest.fn(), onNotification: jest.fn(),
      plugin: { settings: {}, getResolvedProviderCliPath: jest.fn(), mutateSettings: jest.fn() } as any,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});

    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    await kernel.prompt({
      sessionId: session.sessionId,
      prompt: [{ text: '/review please', type: 'text' }],
    } as any);

    expect(mockRequest).toHaveBeenCalledWith('/api/session/ses_test/command', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ name: 'review', text: 'please' }),
    }));
    await kernel.dispose();
  });

  it('attaches explicit skill mentions from inline prompts and steered input', async () => {
    mockRequest.mockImplementation(async (route: string) => {
      if (route === '/api/model') return { data: [{ enabled: true, id: 'm', name: 'Model', providerID: 'test' }] };
      if (route === '/api/command') return { data: [{ name: 'init' }] };
      if (route === '/api/agent') return { data: [] };
      if (route === '/api/session') return { data: { id: 'ses_test' } };
      if (route === '/api/skill') return { data: [{ id: 'project.review' }] };
      return undefined;
    });
    const kernel = new OpencodeHttpSessionKernel({
      config: { vaultWorkingDirectory: '/vault', interactionPort: { dismissInteraction: jest.fn() } } as any,
      getActiveTurnId: () => 'turn_test', onClosed: jest.fn(), onNotification: jest.fn(),
      plugin: { settings: {}, getResolvedProviderCliPath: jest.fn(), mutateSettings: jest.fn() } as any,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});
    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    const input = 'Use /project.review, please.';
    const completion = kernel.prompt({
      sessionId: session.sessionId,
      prompt: [{ text: input, type: 'text' }],
    } as any, { start: 0, end: input.length });
    void completion.catch(() => undefined);
    for (let index = 0; index < 8; index++) await Promise.resolve();

    const promptCall = mockRequest.mock.calls.find(([route, options]) => (
      route === '/api/session/ses_test/prompt' && options?.method === 'POST'
    ));
    expect(promptCall?.[1].body).toMatchObject({
      skills: [{
        id: 'project.review',
        mention: { start: input.indexOf('/project.review'), text: '/project.review' },
      }],
    });

    emitEvent?.({ type: 'session.execution.started', data: { sessionID: session.sessionId } });
    const steerInput = 'Also apply /project.review!';
    const steer = kernel.steer({
      sessionId: session.sessionId,
      prompt: [{ text: steerInput, type: 'text' }],
    } as any, { start: 0, end: steerInput.length });
    for (let index = 0; index < 8; index++) await Promise.resolve();
    const steerCall = mockRequest.mock.calls.find(([route, options]) => (
      route === '/api/session/ses_test/prompt'
      && options?.method === 'POST'
      && (options.body as { delivery?: string }).delivery === 'steer'
    ));
    expect(steerCall).toBeDefined();
    expect(steerCall?.[1].body).toMatchObject({
      skills: [{
        id: 'project.review',
        mention: { start: steerInput.indexOf('/project.review'), text: '/project.review' },
      }],
    });
    emitEvent?.({
      type: 'session.inbox.delivered',
      data: { inboxID: (steerCall?.[1].body as { id: string }).id, sessionID: session.sessionId },
    });
    await expect(steer).resolves.toBe(true);
    await kernel.dispose();
  });

  it.each([
    ['inline code', 'Use `/project.review` as an example.'],
    ['fenced code', 'Example:\n```md\n/project.review\n```'],
    ['indented code', 'Example:\n\n    /project.review'],
  ])('does not attach native skill mentions from %s', async (_kind, input) => {
    mockRequest.mockImplementation(async (route: string) => {
      if (route === '/api/model') return { data: [{ enabled: true, id: 'm', name: 'Model', providerID: 'test' }] };
      if (route === '/api/command') return { data: [{ name: 'init' }] };
      if (route === '/api/agent') return { data: [] };
      if (route === '/api/session') return { data: { id: 'ses_test' } };
      if (route === '/api/skill') return { data: [{ id: 'project.review' }] };
      return undefined;
    });
    const kernel = new OpencodeHttpSessionKernel({
      config: { vaultWorkingDirectory: '/vault', interactionPort: { dismissInteraction: jest.fn() } } as any,
      getActiveTurnId: () => 'turn_test', onClosed: jest.fn(), onNotification: jest.fn(),
      plugin: { settings: {}, getResolvedProviderCliPath: jest.fn(), mutateSettings: jest.fn() } as any,
      sessionInstanceId: 'instance_test',
    }, '/opencode', {});
    await kernel.connect({ profile: 'managed', systemInstructions: { kind: 'none' } });
    const session = await kernel.openSession();
    const completion = kernel.prompt({
      sessionId: session.sessionId,
      prompt: [{ text: input, type: 'text' }],
    } as any, { start: 0, end: input.length });
    void completion.catch(() => undefined);
    for (let index = 0; index < 8; index++) await Promise.resolve();

    const promptCall = mockRequest.mock.calls.find(([route, options]) => (
      route === '/api/session/ses_test/prompt' && options?.method === 'POST'
    ));
    expect(promptCall?.[1].body).not.toHaveProperty('skills');

    emitEvent?.({ type: 'session.execution.started', data: { sessionID: session.sessionId } });
    emitEvent?.({ type: 'session.execution.succeeded', data: { sessionID: session.sessionId } });
    await completion;
    await kernel.dispose();
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

  it('emits only the new suffix when tool progress contains cumulative output snapshots', async () => {
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
    const tool = { sessionID: session.sessionId, assistantMessageID: 'assistant_1', id: 'tool_1' };
    emitEvent?.({ type: 'session.tool.input.started', data: { ...tool, name: 'bash' } });
    emitEvent?.({ type: 'session.tool.called', data: { ...tool, input: { command: 'printf hello' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { output: 'hello' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { output: 'hello world' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { output: 'hello world' } } });

    expect(outputs.filter(event => event.type === 'tool_output')).toEqual([
      expect.objectContaining({ content: 'hello', toolCallId: 'tool_1' }),
      expect.objectContaining({ content: ' world', toolCallId: 'tool_1' }),
    ]);
    await kernel.dispose();
  });

  it('streams native shell output while a tool is running and stops it on completion', async () => {
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
    const route = '/api/shell/shell_1/output?cursor=0&limit=65536';
    mockRequest.mockImplementation(async requestedRoute => (
      requestedRoute === route ? { data: { cursor: 8, output: 'progress' } } : undefined
    ));
    const tool = { sessionID: session.sessionId, assistantMessageID: 'assistant_1', id: 'tool_1' };
    emitEvent?.({ type: 'session.tool.input.started', data: { ...tool, name: 'bash' } });
    emitEvent?.({ type: 'session.tool.called', data: { ...tool, input: { command: 'sleep 1' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { shellID: 'shell_1' } } });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockRequest).toHaveBeenCalledWith(route, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(outputs.filter(event => event.type === 'tool_output')).toEqual([
      expect.objectContaining({ content: 'progress', toolCallId: 'tool_1' }),
    ]);
    emitEvent?.({ type: 'session.tool.success', data: { ...tool, content: [] } });
    await kernel.dispose();
  });

  it('stops appending when OpenCode progress output rolls and keeps the final tool result', async () => {
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
    const tool = { sessionID: session.sessionId, assistantMessageID: 'assistant_1', id: 'tool_rolling' };
    emitEvent?.({ type: 'session.tool.input.started', data: { ...tool, name: 'bash' } });
    emitEvent?.({ type: 'session.tool.called', data: { ...tool, input: { command: 'tail -n 2' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { output: 'line 1\nline 2\n' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { output: 'line 2\nline 3\n' } } });
    emitEvent?.({ type: 'session.tool.progress', data: { ...tool, metadata: { output: 'line 2\nline 3\nline 4\n' } } });
    emitEvent?.({ type: 'session.tool.success', data: { ...tool, content: [{ text: 'line 3\nline 4\n' }] } });

    expect(outputs.filter(event => event.type === 'tool_output')).toEqual([
      expect.objectContaining({ content: 'line 1\nline 2\n', toolCallId: 'tool_rolling' }),
    ]);
    expect(outputs.find(event => event.type === 'tool_completed')).toMatchObject({
      content: 'line 3\nline 4\n', toolCallId: 'tool_rolling',
    });
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
    for (let index = 0; index < 8; index++) await Promise.resolve();
    const steer = kernel.steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Also check tests' }] } as any);
    for (let index = 0; index < 8; index++) await Promise.resolve();
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
    for (let index = 0; index < 8; index++) await Promise.resolve();
    const steer = kernel.steer({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Also check tests' }] } as any);
    for (let index = 0; index < 8; index++) await Promise.resolve();
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
