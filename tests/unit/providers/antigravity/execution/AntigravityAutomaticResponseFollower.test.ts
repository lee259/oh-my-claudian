/** @jest-environment jsdom */

import type { ChatMessage } from '@/core/types';

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
  readAntigravityAutomaticResponses: jest.fn(),
  readAntigravityTranscript: jest.fn(),
  readAntigravityTurnBoundary: jest.fn(),
}));

import { AntigravityAutomaticResponseFollower } from '@/providers/antigravity/execution/AntigravityAutomaticResponseFollower';
import {
  hasAntigravityOutstandingSubagents,
  readAntigravityAutomaticResponses,
  readAntigravityTranscript,
  readAntigravityTurnBoundary,
} from '@/providers/antigravity/history/AntigravityHistoryStore';

const transcript = { argumentsEncoded: false, steps: [] };

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

it('retries the turn boundary after a transcript read fails', async () => {
  jest.useFakeTimers();
  const read = jest.mocked(readAntigravityTranscript);
  read
    .mockRejectedValueOnce(new Error('EIO: i/o error, read'))
    .mockResolvedValue(transcript);
  jest.mocked(readAntigravityTurnBoundary).mockReturnValue({ userInput: 1, lastStep: 2 });
  jest.mocked(hasAntigravityOutstandingSubagents).mockReturnValue(false);
  const message = { id: 'late-reply', role: 'assistant', content: 'Late reply', timestamp: 1 } as ChatMessage;
  jest.mocked(readAntigravityAutomaticResponses).mockReturnValue([{
    message,
    afterUserInput: 1,
    startStep: 3,
    complete: true,
  }]);
  const publish = jest.fn();
  const follower = new AntigravityAutomaticResponseFollower({
    storeRoot: '/native',
    sessionId: 'session-1',
    publish,
  });

  try {
    follower.subagentLaunched();
    follower.turnEnded(true);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();

    const callbacks = (jest.requireMock('node:fs') as { __watchCallbacks: Array<() => void> }).__watchCallbacks;
    callbacks.at(-1)?.();
    await jest.advanceTimersByTimeAsync(200);
    await flushPromises();

    expect(read).toHaveBeenCalledTimes(2);
    expect(readAntigravityTurnBoundary).toHaveBeenCalledWith(transcript);
    expect(publish).toHaveBeenCalledWith(message);
  } finally {
    await follower.dispose();
    jest.useRealTimers();
  }
});
