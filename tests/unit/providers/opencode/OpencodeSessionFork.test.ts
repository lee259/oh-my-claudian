import { forkOpencodeHttpSession } from '@/providers/opencode/history/OpencodeSessionFork';

describe('forkOpencodeHttpSession', () => {
  it('retains the selected reply and excludes later native messages', async () => {
    const client = {
      request: jest.fn()
        .mockResolvedValueOnce({
          data: [
            { id: 'user-1', type: 'user' },
            { id: 'assistant-1', type: 'assistant' },
            { id: 'idle-1', type: 'idle' },
            { id: 'user-2', type: 'user' },
            { id: 'assistant-2', type: 'assistant' },
          ],
          cursor: {},
        })
        .mockResolvedValueOnce({ data: { id: 'child-session' } }),
    };

    await expect(forkOpencodeHttpSession(client, 'source-session', 'assistant-1'))
      .resolves.toBe('child-session');

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      '/api/session/source-session/message?limit=200&order=asc',
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      '/api/session/source-session/fork',
      { method: 'POST', body: { before: 'idle-1' } },
    );
  });

  it('uses the native latest-session fork when the checkpoint is the last message', async () => {
    const client = {
      request: jest.fn()
        .mockResolvedValueOnce({ data: [{ id: 'assistant-last', type: 'assistant' }], cursor: {} })
        .mockResolvedValueOnce({ data: { id: 'child-session' } }),
    };

    await forkOpencodeHttpSession(client, 'source-session', 'assistant-last');

    expect(client.request).toHaveBeenLastCalledWith(
      '/api/session/source-session/fork',
      { method: 'POST', body: {} },
    );
  });

  it('follows native history cursors without repeating the initial order', async () => {
    const client = {
      request: jest.fn()
        .mockResolvedValueOnce({
          data: [{ id: 'assistant-1', type: 'assistant' }],
          cursor: { next: 'next-page' },
        })
        .mockResolvedValueOnce({ data: [{ id: 'user-2', type: 'user' }], cursor: {} })
        .mockResolvedValueOnce({ data: { id: 'child-session' } }),
    };

    await forkOpencodeHttpSession(client, 'source-session', 'assistant-1');

    expect(client.request).toHaveBeenNthCalledWith(
      2,
      '/api/session/source-session/message?limit=200&cursor=next-page',
    );
    expect(client.request).toHaveBeenLastCalledWith(
      '/api/session/source-session/fork',
      { method: 'POST', body: { before: 'user-2' } },
    );
  });

  it('rejects a missing checkpoint without creating a native fork', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({ data: [{ id: 'other', type: 'assistant' }], cursor: {} }),
    };

    await expect(forkOpencodeHttpSession(client, 'source-session', 'missing'))
      .rejects.toThrow('OpenCode fork checkpoint not found');
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});
