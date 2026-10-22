import { createProviderExecutionContractCases } from '@test/helpers/providerExecutionContractRunner';

import { OmpExecutionSession } from '@/providers/omp/execution/OmpExecutionSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

describe('OmpExecutionSession', () => {
  it('marks resumed usage defaults as provisional until native usage arrives', async () => {
    const prompt = deferred<{ userMessageId: string }>();
    let notify: any;
    const session = new OmpExecutionSession({ settings: {} } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
      resumeSeed: { providerSessionId: 'existing-session' },
    }, {
      createKernel: options => {
        notify = options.onNotification;
        return {
          cancel: jest.fn(), connect: jest.fn().mockResolvedValue(undefined),
          dispose: jest.fn().mockResolvedValue(undefined),
          openSession: jest.fn().mockResolvedValue({ configOptions: [], sessionId: 'existing-session' }),
          prompt: jest.fn().mockReturnValue(prompt.promise),
          setConfigOption: jest.fn().mockResolvedValue(undefined), setModel: jest.fn().mockResolvedValue(undefined),
        } as never;
      },
    });
    const run = session.execute({
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ type: 'text', text: 'Continue' }], signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    } as never);
    const events: any[] = [];
    const collecting = (async () => { for await (const event of run.events) events.push(event); })();
    await flush();
    const initialEvents = [...events];
    await notify({ sessionId: 'existing-session', update: { sessionUpdate: 'usage_update', size: 1_000_000, used: 99_000 } });
    prompt.resolve({ userMessageId: 'continued' });
    await collecting;
    await session.dispose();

    expect(initialEvents.filter(event => event.type === 'usage_updated')).toEqual([
      expect.objectContaining({ usage: expect.objectContaining({ contextUsageIsProvisional: true }) }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'usage_updated', usage: expect.objectContaining({ contextTokens: 99_000, contextWindow: 1_000_000 }),
    }));
  });

  it('records provider execution errors when diagnostic logging is available', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const session = new OmpExecutionSession({
      diagnosticLog: { write },
      settings: {},
    } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
    }, {
      createKernel: () => ({
        cancel: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn().mockResolvedValue(undefined),
        openSession: jest.fn().mockResolvedValue({ configOptions: [], sessionId: 'omp-session' }),
        prompt: jest.fn().mockRejectedValue(new Error('ACP prompt failed')),
        setConfigOption: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
      }),
    });

    const run = session.execute({
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ text: 'Hello', type: 'text' }],
      signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    } as never);
    for await (const event of run.events) void event;

    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'execution-error',
      message: 'ACP prompt failed',
      source: 'omp',
    }));
  });

  it('restarts the ACP process with the selected native approval mode and resumes the same session', async () => {
    const createdOptions: any[] = [];
    const firstKernel = {
      cancel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({ configOptions: [], sessionId: 'omp-session' }),
      prompt: jest.fn().mockResolvedValue({ userMessageId: 'first' }),
      setConfigOption: jest.fn().mockResolvedValue(undefined),
      setModel: jest.fn().mockResolvedValue(undefined),
    };
    const secondKernel = {
      ...firstKernel,
      openSession: jest.fn().mockResolvedValue({ configOptions: [], sessionId: 'omp-session' }),
      prompt: jest.fn().mockResolvedValue({ userMessageId: 'second' }),
    };
    const session = new OmpExecutionSession({ settings: {} } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
    }, {
      createKernel: options => {
        createdOptions.push(options);
        return createdOptions.length === 1 ? firstKernel : secondKernel;
      },
    });
    const request = (permissionMode: string) => ({
      configuration: {
        permissionMode,
        systemInstructions: { kind: 'provider-default' },
      },
      input: [{ text: 'Hello', type: 'text' }],
      signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    }) as never;

    const first = session.execute(request('always-ask'));
    for await (const event of first.events) void event;
    const second = session.execute(request('write'));
    for await (const event of second.events) void event;

    expect(createdOptions.map(options => options.approvalMode)).toEqual(['always-ask', 'write']);
    expect(firstKernel.dispose).toHaveBeenCalledTimes(1);
    expect(secondKernel.openSession).toHaveBeenCalledWith('omp-session');
  });

  it('routes second-turn ACP notifications to the active run', async () => {
    const firstPrompt = deferred<{ userMessageId: string }>();
    const secondPrompt = deferred<{ userMessageId: string }>();
    let kernelOptions: any;
    const kernel = {
      cancel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({ configOptions: [], sessionId: 'omp-session' }),
      prompt: jest.fn()
        .mockReturnValueOnce(firstPrompt.promise)
        .mockReturnValueOnce(secondPrompt.promise),
      setConfigOption: jest.fn().mockResolvedValue(undefined),
      setModel: jest.fn().mockResolvedValue(undefined),
    };
    const session = new OmpExecutionSession({ settings: {} } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
    }, {
      createKernel: options => {
        kernelOptions = options;
        return kernel;
      },
    });
    const request = {
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ text: 'Hello', type: 'text' }],
      signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    } as never;

    const first = session.execute(request);
    const firstEvents: unknown[] = [];
    const collectFirst = (async () => {
      for await (const event of first.events) firstEvents.push(event);
    })();
    await flush();
    await kernelOptions.onNotification({
      sessionId: 'omp-session',
      update: { sessionUpdate: 'usage_update', size: 200_000, used: 30_000 },
    });
    firstPrompt.resolve({ userMessageId: 'first' });
    await collectFirst;
    expect(firstEvents).toContainEqual(expect.objectContaining({
      type: 'usage_updated',
      usage: expect.objectContaining({ percentage: 0 }),
    }));

    const second = session.execute(request);
    const events: unknown[] = [];
    const collecting = (async () => {
      for await (const event of second.events) events.push(event);
    })();
    await flush();
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'usage_updated',
      usage: expect.objectContaining({ percentage: 0 }),
    }));
    await kernelOptions.onNotification({
      sessionId: 'omp-session',
      update: {
        content: { text: 'Second reply', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      },
    });
    await kernelOptions.onNotification({
      sessionId: 'omp-session',
      update: { sessionUpdate: 'usage_update', size: 200_000, used: 42_000 },
    });
    secondPrompt.resolve({ userMessageId: 'second' });
    await collecting;

    expect(events).toContainEqual(expect.objectContaining({
      text: 'Second reply',
      type: 'text_delta',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'usage_updated',
      usage: expect.objectContaining({ contextTokens: 42_000, percentage: 21 }),
    }));
  });
});

describe('OMP provider execution contract', () => {
  it.each(createProviderExecutionContractCases({
    createRequest: signal => ({
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ text: 'Hello', type: 'text' }],
      signal: signal ?? new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    }),
    createSession: () => {
      let kernelOptions: any;
      const kernel = {
        cancel: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn().mockResolvedValue(undefined),
        openSession: jest.fn().mockResolvedValue({ configOptions: [], sessionId: 'contract-session' }),
        prompt: jest.fn().mockImplementation(async () => {
          await flush();
          await kernelOptions.onNotification({
            sessionId: 'contract-session',
            update: {
              content: { text: 'contract response', type: 'text' },
              sessionUpdate: 'agent_message_chunk',
            },
          });
          return { userMessageId: 'contract-user' };
        }),
        setConfigOption: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
      };
      return new OmpExecutionSession({ settings: {} } as never, {
        interactionPort: {} as never,
        lifecycle: 'persistent',
        nativePersistence: 'provider-default',
        vaultWorkingDirectory: '/vault',
      }, {
        createKernel: options => {
          kernelOptions = options;
          return kernel;
        },
      });
    },
  }))('%s', async (_name, test) => {
    expect(typeof test).toBe('function');
    await test();
  });
});

function createRoleHarness(resume = true) {
  const kernelOptions: any[] = [];
  const live = {
    cancel: jest.fn(), connect: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined),
    openSession: jest.fn().mockResolvedValue({ sessionId: 'live-session', configOptions: [
      { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'high', options: [
        { value: 'off', name: 'Off' }, { value: 'high', name: 'High' },
      ] },
    ] }),
    prompt: jest.fn().mockResolvedValue({ userMessageId: 'user' }),
    setModel: jest.fn(), setConfigOption: jest.fn(),
  };
  const metadata = {
    ...live, dispose: jest.fn().mockResolvedValue(undefined), prompt: jest.fn(),
    openSession: jest.fn().mockResolvedValue({ sessionId: 'probe-session', configOptions: [
      { id: 'model', type: 'select', currentValue: 'openai/gpt-5-mini', options: [] },
      { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'off', options: [] },
    ] }),
  };
  const session = new OmpExecutionSession({
    settings: {}, app: { vault: { adapter: { basePath: '/vault' } } },
  } as never, {
    interactionPort: {} as never, lifecycle: 'persistent',
    nativePersistence: 'provider-default', vaultWorkingDirectory: '/vault/project',
    ...(resume ? { resumeSeed: { providerSessionId: 'live-session', providerState: {
      ompSelection: { model: '@default', reasoning: 'role-default' },
    } } } : {}),
  }, { createKernel: options => {
    kernelOptions.push(options);
    return options.isolateNativeSessions ? metadata : live;
  } });
  const request = (reasoning = 'role-default', signal = new AbortController().signal) => ({
    configuration: { model: 'omp:@smol', reasoning, systemInstructions: { kind: 'provider-default' } },
    input: [{ text: 'Hello', type: 'text' }], signal, toolPolicy: { kind: 'provider-default' },
  }) as never;
  return { session, live, metadata, request, kernelOptions };
}

it('resolves an explicitly changed role once and applies a later reasoning override without resetting the model', async () => {
  const { session, live, metadata, request } = createRoleHarness();
  const events = [];
  for await (const event of session.execute(request()).events) events.push(event);
  expect(live.setModel).toHaveBeenLastCalledWith({ sessionId: 'live-session', modelId: 'openai/gpt-5-mini' });
  expect(live.setConfigOption).toHaveBeenLastCalledWith({
    sessionId: 'live-session', configId: 'thinking', type: 'select', value: 'off',
  });
  expect(events).toContainEqual(expect.objectContaining({
    type: 'usage_updated', usage: expect.objectContaining({ model: 'openai/gpt-5-mini' }),
  }));
  metadata.openSession.mockResolvedValueOnce({ sessionId: 'second-probe', configOptions: [
    { id: 'model', type: 'select', currentValue: 'anthropic/claude-sonnet', options: [] },
    { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'off', options: [] },
  ] });
  for await (const event of session.execute(request('high')).events) void event;
  expect(live.setModel).toHaveBeenCalledTimes(1);
  expect(live.setConfigOption).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'high' }));
  expect(live.openSession).toHaveBeenLastCalledWith('live-session');
  expect(metadata.prompt).not.toHaveBeenCalled();
  expect(metadata.dispose).toHaveBeenCalledTimes(1);
  await session.dispose();
});

it('fails role resolution without sending a prompt or an alias as a concrete model', async () => {
  const { session, live, metadata, request } = createRoleHarness();
  metadata.openSession.mockRejectedValueOnce(new Error('Unknown OMP role'));
  const events = [];
  for await (const event of session.execute(request()).events) events.push(event);
  expect(events).toContainEqual(expect.objectContaining({ type: 'execution_error', message: 'Unknown OMP role' }));
  expect(live.prompt).not.toHaveBeenCalled();
  expect(live.setModel).not.toHaveBeenCalled();
  expect(metadata.dispose).toHaveBeenCalledTimes(1);
  await session.dispose();
});

it.each(['stop', 'abort', 'dispose'])('cleans up role resolution on %s and never sends after cancellation', async action => {
  const { session, live, metadata, request } = createRoleHarness();
  const pending = deferred<never>();
  metadata.openSession.mockReturnValueOnce(pending.promise);
  const controller = new AbortController();
  const run = session.execute(request('role-default', controller.signal));
  await flush();
  expect(metadata.openSession).toHaveBeenCalled();
  if (action === 'stop') run.cancel();
  else if (action === 'abort') controller.abort();
  else await session.dispose();
  expect(metadata.dispose).toHaveBeenCalledTimes(1);
  // The boundary can finish late, after its process has been stopped.
  pending.resolve({ sessionId: 'late', configOptions: [] } as never);
  for await (const event of run.events) void event;
  await flush();
  expect(live.prompt).not.toHaveBeenCalled();
  expect(live.setModel).not.toHaveBeenCalled();
  await session.dispose();
});

it('waits for the role metadata process to finish disposal before releasing the execution owner', async () => {
  const { session, metadata, request } = createRoleHarness();
  const cleanup = deferred<void>();
  metadata.openSession.mockReturnValueOnce(new Promise<never>(() => undefined));
  metadata.dispose.mockReturnValueOnce(cleanup.promise);
  const run = session.execute(request());
  await flush();
  let disposed = false;
  const disposing = session.dispose().then(() => { disposed = true; });
  await flush();
  expect(disposed).toBe(false);
  cleanup.resolve();
  await disposing;
  expect(metadata.dispose).toHaveBeenCalledTimes(1);
  for await (const event of run.events) void event;
});


it('starts the real ACP process with a role and preserves native model handoffs across turns', async () => {
  const { session, live, metadata, request, kernelOptions } = createRoleHarness(false);
  live.openSession.mockResolvedValueOnce({ sessionId: 'live-session', configOptions: [
    { id: 'model', type: 'select', currentValue: 'openai/planner', options: [] },
  ] });
  live.prompt.mockImplementationOnce(async () => {
    const options = kernelOptions.find(options => !options.isolateNativeSessions);
    options.onNotification({ sessionId: 'live-session', update: {
      sessionUpdate: 'config_option_update', configOptions: [
        { id: 'model', type: 'select', currentValue: 'openai/worker', options: [] },
      ],
    } });
    return { userMessageId: 'first' };
  });
  const events = [];
  for await (const event of session.execute(request()).events) events.push(event);
  live.openSession.mockResolvedValueOnce({ sessionId: 'live-session', configOptions: [
    { id: 'model', type: 'select', currentValue: 'openai/worker', options: [] },
  ] });
  for await (const event of session.execute(request()).events) events.push(event);
  expect(kernelOptions).toHaveLength(1);
  expect(kernelOptions[0].modelSelector).toBe('@smol');
  expect(live.setModel).not.toHaveBeenCalled();
  expect(live.setConfigOption).not.toHaveBeenCalled();
  expect(metadata.openSession).not.toHaveBeenCalled();
  expect(events).toContainEqual(expect.objectContaining({
    type: 'usage_updated', usage: expect.objectContaining({ model: 'openai/worker' }),
  }));
  expect(session.getSnapshot().providerState).toEqual({
    ompSelection: { model: '@smol', reasoning: 'role-default' },
  });
  await session.dispose();
});


it('accepts the native restored model without reapplying the saved role or reasoning', async () => {
  const { live, metadata, request } = createRoleHarness(false);
  live.openSession.mockResolvedValue({ sessionId: 'live-session', configOptions: [
    { id: 'model', type: 'select', currentValue: 'openai/worker', options: [] },
  ] });
  const resumed = new OmpExecutionSession({ settings: {} } as never, {
    interactionPort: {} as never, lifecycle: 'persistent', nativePersistence: 'provider-default',
    vaultWorkingDirectory: '/vault/project', resumeSeed: {
      providerSessionId: 'live-session', providerState: {
        ompSelection: { model: '@smol', reasoning: 'high' },
      },
    },
  }, { createKernel: options => options.isolateNativeSessions ? metadata : live });
  for await (const event of resumed.execute(request('high')).events) void event;
  expect(live.openSession).toHaveBeenCalledWith('live-session');
  expect(live.setModel).not.toHaveBeenCalled();
  expect(live.setConfigOption).not.toHaveBeenCalled();
  expect(metadata.openSession).not.toHaveBeenCalled();
  await resumed.dispose();
});
