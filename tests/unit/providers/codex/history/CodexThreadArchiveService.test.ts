import { CodexThreadArchiveService } from '@/providers/codex/history/CodexThreadArchiveService';
import { CodexRpcResponseError } from '@/providers/codex/runtime/CodexRpcTransport';

const mockRequest = jest.fn();
const mockDispose = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue(undefined);
const mockResolveLaunchSpec = jest.fn();

jest.mock('@/providers/codex/runtime/CodexRpcTransport', () => ({
  ...jest.requireActual('@/providers/codex/runtime/CodexRpcTransport'),
  CodexRpcTransport: jest.fn().mockImplementation(() => ({
    request: mockRequest,
    dispose: mockDispose,
    start: jest.fn(),
  })),
}));

jest.mock('@/providers/codex/runtime/CodexAppServerProcess', () => ({
  CodexAppServerProcess: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: mockShutdown,
  })),
}));

jest.mock('@/providers/codex/runtime/codexAppServerSupport', () => ({
  initializeCodexAppServerTransport: jest.fn().mockResolvedValue({}),
  resolveCodexAppServerLaunchSpec: (...args: unknown[]) => mockResolveLaunchSpec(...args),
}));

const conversation = (sessionId: string | null, providerState?: Record<string, unknown>) => ({
  id: sessionId ?? 'pending-fork',
  providerId: 'codex' as const,
  sessionId,
  title: 'Test conversation',
  createdAt: 1,
  lastActivityAt: 1,
  providerState,
  messages: [],
});

describe('CodexThreadArchiveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.mockResolvedValue({});
    mockResolveLaunchSpec.mockResolvedValue({});
  });

  it('applies archive and restore in order through one short-lived app-server', async () => {
    const service = new CodexThreadArchiveService({} as never);

    await service.setSessionsArchived([
      { conversation: conversation('thread-1', { threadId: 'thread-1' }), isArchived: true },
      { conversation: conversation('thread-2'), isArchived: false },
    ]);

    expect(mockRequest.mock.calls).toEqual([
      ['thread/archive', { threadId: 'thread-1' }],
      ['thread/unarchive', { threadId: 'thread-2' }],
    ]);
    expect(mockResolveLaunchSpec).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });

  it('does not target the source thread when a fork has no native session of its own', async () => {
    const service = new CodexThreadArchiveService({} as never);

    await service.setSessionsArchived([{
      conversation: conversation(null, {
        forkSource: { sessionId: 'source-thread', resumeAtMessageId: 'turn-1' },
      }),
      isArchived: true,
    }]);

    expect(mockResolveLaunchSpec).not.toHaveBeenCalled();
  });

  it.each([
    ['thread/archive', true, 'no rollout found for thread id thread-1'],
    ['thread/unarchive', false, 'no archived rollout found for thread id thread-1'],
  ])('treats a thread already in the requested state as complete', async (method, isArchived, message) => {
    mockRequest.mockImplementation((requestMethod: string) => (
      requestMethod === method
        ? Promise.reject(new CodexRpcResponseError({ code: -32600, message: String(message) }))
        : Promise.resolve({})
    ));
    const service = new CodexThreadArchiveService({} as never);

    await expect(service.setSessionsArchived([{
      conversation: conversation('thread-1'),
      isArchived: Boolean(isArchived),
    }])).resolves.toBeUndefined();
  });

  it('attempts later changes before reporting an earlier failure and closes the app-server', async () => {
    mockRequest.mockImplementation((method: string, params?: { threadId: string }) => (
      method === 'thread/archive' && params?.threadId === 'thread-1'
        ? Promise.reject(new CodexRpcResponseError({ code: -32603, message: 'disk full' }))
        : Promise.resolve({})
    ));
    const service = new CodexThreadArchiveService({} as never);

    await expect(service.setSessionsArchived([
      { conversation: conversation('thread-1'), isArchived: true },
      { conversation: conversation('thread-2'), isArchived: true },
    ])).rejects.toThrow('disk full');
    expect(mockRequest).toHaveBeenCalledWith('thread/archive', { threadId: 'thread-2' });
    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });
});
