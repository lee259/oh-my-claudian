import type { ProviderExecutionInputBlock, ProviderExecutionRequest } from '../../../../../src/core/execution';
import type { AcpSessionNotification } from '../../../../../src/providers/acp';
import type { DshAcpSessionKernelOptions } from '../../../../../src/providers/dsh/execution/DshAcpSessionKernel';
import { buildDshPrompt, DshExecutionSession } from '../../../../../src/providers/dsh/execution/DshExecutionSession';

describe('DshExecutionSession', () => {
  it('clears a confirmed stale resume id after surfacing the resume error', async () => {
    const kernel = {
      cancel: jest.fn(),
      closeSession: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn()
        .mockRejectedValueOnce(new Error('Invalid params: session is not resumable: stale-session'))
        .mockResolvedValueOnce({ configOptions: [], resumed: false, sessionId: 'new-session' }),
      prompt: jest.fn().mockResolvedValue({ userMessageId: 'message' }),
      setConfigOption: jest.fn().mockResolvedValue(undefined),
    };
    const session = new DshExecutionSession({ settings: {} } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      resumeSeed: { providerSessionId: 'stale-session' },
      vaultWorkingDirectory: '/vault',
    }, { createKernel: () => kernel });
    const request = {
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ text: 'Hello', type: 'text' }],
      signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    } as never;

    const failedRun = session.execute(request);
    const failedEvents = [];
    for await (const event of failedRun.events) failedEvents.push(event);
    expect(failedEvents.at(-1)).toEqual(expect.objectContaining({
      category: 'provider',
      message: 'Invalid params: session is not resumable: stale-session',
      type: 'execution_error',
    }));

    const nextRun = session.execute(request);
    for await (const event of nextRun.events) void event;

    expect(kernel.openSession).toHaveBeenNthCalledWith(1, 'stale-session');
    expect(kernel.openSession).toHaveBeenNthCalledWith(2, undefined);
    await session.dispose();
  });

  it('keeps a persistent DSH session resumable after a failed turn', async () => {
    const firstKernel = {
      cancel: jest.fn(),
      closeSession: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({ configOptions: [], resumed: false, sessionId: 'dsh-session' }),
      prompt: jest.fn().mockRejectedValue(new Error('Insufficient Balance')),
      setConfigOption: jest.fn().mockResolvedValue(undefined),
    };
    const secondKernel = {
      ...firstKernel,
      openSession: jest.fn().mockResolvedValue({ configOptions: [], resumed: true, sessionId: 'dsh-session' }),
      prompt: jest.fn().mockResolvedValue({ userMessageId: 'message-2' }),
    };
    let kernelCount = 0;
    const session = new DshExecutionSession({ settings: {} } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
    }, {
      createKernel: () => kernelCount++ === 0 ? firstKernel : secondKernel,
    });
    const request = {
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ text: 'Hello', type: 'text' }],
      signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    } as never;

    const failedRun = session.execute(request);
    const failedEvents = [];
    for await (const event of failedRun.events) failedEvents.push(event);
    const nextRun = session.execute(request);
    for await (const event of nextRun.events) void event;

    expect(firstKernel.closeSession).not.toHaveBeenCalled();
    expect(failedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ snapshot: expect.objectContaining({ providerSessionId: 'dsh-session', status: 'invalidated' }), type: 'session_state_changed' }),
    ]));
    expect(secondKernel.openSession).toHaveBeenCalledWith('dsh-session');
    await session.dispose();
    expect(secondKernel.closeSession).not.toHaveBeenCalled();
  });

  it('uses DSH context usage updates without resetting usage at each turn', async () => {
    let kernelOptions: DshAcpSessionKernelOptions | undefined;
    const session = new DshExecutionSession({ settings: {} } as never, {
      interactionPort: {} as never,
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
    }, {
      createKernel: options => {
        kernelOptions = options;
        return {
          cancel: jest.fn(),
          closeSession: jest.fn().mockResolvedValue(undefined),
          connect: jest.fn().mockResolvedValue(undefined),
          dispose: jest.fn().mockResolvedValue(undefined),
          openSession: jest.fn().mockResolvedValue({ configOptions: [], resumed: false, sessionId: 'dsh-session' }),
          prompt: jest.fn(async ({ sessionId }) => {
            kernelOptions?.onNotification({
              sessionId,
              update: { sessionUpdate: 'usage_update', size: 262_144, used: 16_729 },
            } satisfies AcpSessionNotification);
            return { userMessageId: 'message' };
          }),
          setConfigOption: jest.fn().mockResolvedValue(undefined),
        };
      },
    });
    const run = session.execute({
      configuration: { systemInstructions: { kind: 'provider-default' } },
      input: [{ text: 'Hello', type: 'text' }],
      signal: new AbortController().signal,
      toolPolicy: { kind: 'provider-default' },
    } as never);
    const events = [];
    for await (const event of run.events) events.push(event);

    const usageEvents = events.filter(event => event.type === 'usage_updated');
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toEqual(expect.objectContaining({
      usage: expect.objectContaining({
        contextTokens: 16_729,
        contextWindow: 262_144,
        contextWindowIsAuthoritative: true,
        contextUsageSnapshot: true,
        percentage: 6,
      }),
    }));
    await session.dispose();
  });
});

describe('buildDshPrompt', () => {
  const request = (input: ProviderExecutionRequest['input'], instructions = ''): ProviderExecutionRequest => ({
    configuration: {
      systemInstructions: instructions ? { kind: 'explicit', instructions } : { kind: 'none' },
    },
    input,
    signal: new AbortController().signal,
    toolPolicy: { kind: 'provider-default' },
  });

  it('keeps explicit instructions and user text in the prompt', () => {
    expect(buildDshPrompt(request([{ text: 'Do the task', type: 'text' }], 'Use concise answers.'))).toEqual([
      { text: 'Additional instructions:\nUse concise answers.\n\nDo the task', type: 'text' },
    ]);
  });

  it('forwards supported raster image attachments', () => {
    expect(buildDshPrompt(request([
      { text: 'Inspect this', type: 'text' },
      {
        image: {
          data: 'base64-data',
          id: 'image-1',
          mediaType: 'image/png',
          name: 'diagram.png',
          size: 123,
          source: 'file',
        },
        type: 'image',
      },
    ]))).toEqual([
      { text: 'Inspect this', type: 'text' },
      { data: 'base64-data', mimeType: 'image/png', type: 'image' },
    ]);
  });

  it('fails clearly for unsupported image formats instead of dropping them', () => {
    const unsupportedImage = {
      image: {
        data: 'base64-data',
        id: 'image-2',
        mediaType: 'image/svg+xml',
        name: 'diagram.svg',
        size: 123,
        source: 'file',
      },
      type: 'image',
    } as unknown as ProviderExecutionInputBlock;
    expect(() => buildDshPrompt(request([unsupportedImage])))
      .toThrow('DeepSeek Harness supports raster images only; image/svg+xml cannot be attached.');
  });
});
