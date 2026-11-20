/** @jest-environment jsdom */

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  const callbacks: Array<() => void> = [];
  return {
    ...actual,
    watch: jest.fn((_path: string, callback: () => void) => {
      callbacks.push(callback);
      return { on: jest.fn(), close: jest.fn() };
    }),
    __watchCallbacks: callbacks,
  };
});

jest.mock('@/providers/antigravity/history/AntigravityHistoryStore', () => ({
  hasAntigravityOutstandingSubagents: jest.fn(),
  readAntigravityHistoryRevision: jest.fn(),
  readAntigravityLatestRequest: jest.fn(),
  readAntigravityTranscript: jest.fn(),
}));

import { AntigravitySubagentWatcher } from '@/providers/antigravity/execution/AntigravitySubagentWatcher';
import {
  hasAntigravityOutstandingSubagents,
  readAntigravityHistoryRevision,
  readAntigravityLatestRequest,
  readAntigravityTranscript,
} from '@/providers/antigravity/history/AntigravityHistoryStore';

const transcript = { argumentsEncoded: false, steps: [] };

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

it('records the latest request after a failed read and releases the session once subagents report', async () => {
  jest.useFakeTimers();
  const read = jest.mocked(readAntigravityTranscript);
  read
    .mockRejectedValueOnce(new Error('EIO: i/o error, read'))
    .mockResolvedValue(transcript);
  jest.mocked(readAntigravityLatestRequest).mockReturnValue(1);
  jest.mocked(hasAntigravityOutstandingSubagents).mockReturnValue(false);
  const watcher = new AntigravitySubagentWatcher({
    storeRoot: '/native',
    sessionId: 'session-1',
  });

  try {
    watcher.subagentLaunched();
    watcher.turnEnded(true);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(1);
    expect(watcher.isWatching).toBe(true);

    const callbacks = (jest.requireMock('node:fs') as { __watchCallbacks: Array<() => void> }).__watchCallbacks;
    callbacks.at(-1)?.();
    await jest.advanceTimersByTimeAsync(200);
    await flushPromises();

    expect(read).toHaveBeenCalledTimes(2);
    expect(readAntigravityLatestRequest).toHaveBeenCalledWith(transcript);
    expect(hasAntigravityOutstandingSubagents).toHaveBeenCalledWith(transcript, 1);
    expect(watcher.isWatching).toBe(false);
  } finally {
    await watcher.dispose();
    jest.useRealTimers();
  }
});

it('polls either transcript when directory watching is unavailable', async () => {
  jest.useFakeTimers();
  const fs = jest.requireMock('node:fs') as { watch: jest.Mock };
  fs.watch.mockImplementationOnce(() => {
    throw new Error('watch unavailable');
  });
  jest.mocked(readAntigravityTranscript).mockResolvedValue(transcript);
  jest.mocked(hasAntigravityOutstandingSubagents).mockReturnValue(true);
  jest.mocked(readAntigravityHistoryRevision).mockResolvedValue('revision-1');
  const watcher = new AntigravitySubagentWatcher({
    storeRoot: '/native',
    sessionId: 'session-1',
  });

  try {
    watcher.subagentLaunched();
    watcher.turnEnded(true);
    await flushPromises();

    expect(readAntigravityHistoryRevision).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(readAntigravityHistoryRevision).toHaveBeenCalledWith('/native', 'session-1');
  } finally {
    await watcher.dispose();
    jest.useRealTimers();
  }
});
