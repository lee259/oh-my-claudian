import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { testDate, testTime } from '@test/helpers/testClock';

import {
  type ClaudeSessionTimeCandidate,
  recoverSDKSessionIdByTime,
  selectClaudeSessionRecoveryCandidate,
} from '@/providers/claude/history/ClaudeSessionRecovery';
import { encodeVaultPathForSDK } from '@/providers/claude/history/sdkSessionPaths';

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof fs>('node:fs/promises');
  return { ...actual, open: jest.fn(actual.open) };
});

const candidates: ClaudeSessionTimeCandidate[] = [
  {
    sessionId: 'closest-start-wrong-end',
    firstTimestamp: 1_200,
    lastTimestamp: 40_000,
    hasAssistantMessage: true,
  },
  {
    sessionId: 'matching-session',
    firstTimestamp: 1_900,
    lastTimestamp: 10_500,
    hasAssistantMessage: true,
  },
];

describe('selectClaudeSessionRecoveryCandidate', () => {
  it('uses the start and end timestamps to identify a native transcript', () => {
    expect(selectClaudeSessionRecoveryCandidate(candidates, {
      createdAt: 1_000,
      lastActivityAt: 10_000,
    })).toBe('matching-session');
  });

  it('refuses candidates that remain temporally ambiguous', () => {
    expect(selectClaudeSessionRecoveryCandidate([
      {
        sessionId: 'first',
        firstTimestamp: 1_100,
        lastTimestamp: 10_100,
        hasAssistantMessage: true,
      },
      {
        sessionId: 'second',
        firstTimestamp: 1_200,
        lastTimestamp: 10_200,
        hasAssistantMessage: true,
      },
    ], {
      createdAt: 1_000,
      lastActivityAt: 10_000,
    })).toBeNull();
  });

  it('requires a strict and unique creation-time match without a response timestamp', () => {
    expect(selectClaudeSessionRecoveryCandidate([
      {
        sessionId: 'matching-session',
        firstTimestamp: 1_200,
        lastTimestamp: 2_000,
        hasAssistantMessage: false,
      },
      {
        sessionId: 'too-far',
        firstTimestamp: 20_000,
        lastTimestamp: 21_000,
        hasAssistantMessage: false,
      },
    ], {
      createdAt: 1_000,
    })).toBe('matching-session');
  });

  it('rejects a transcript outside the strict creation window even when activity matches', () => {
    expect(selectClaudeSessionRecoveryCandidate([
      {
        sessionId: 'unrelated',
        firstTimestamp: 12_000,
        lastTimestamp: 30_000,
        hasAssistantMessage: false,
      },
    ], {
      createdAt: 1_000,
      lastActivityAt: 30_000,
    })).toBeNull();
  });

  it('rejects a creation-only match after local-only activity', () => {
    expect(selectClaudeSessionRecoveryCandidate([
      {
        sessionId: 'matching-session',
        firstTimestamp: 1_200,
        lastTimestamp: 2_000,
        hasAssistantMessage: true,
      },
    ], {
      createdAt: 1_000,
      lastActivityAt: 10 * 60_000,
    })).toBeNull();
  });

  it('allows a wider creation window when assistant activity corroborates the transcript', () => {
    expect(selectClaudeSessionRecoveryCandidate([
      {
        sessionId: 'slow-start-session',
        firstTimestamp: 61_000,
        lastTimestamp: 90_000,
        hasAssistantMessage: true,
      },
    ], {
      createdAt: 1_000,
      lastActivityAt: 90_000,
    })).toBe('slow-start-session');
  });
});

describe('native transcript edge sampling', () => {
  const vault = '/recovery-vault';
  const sessionId = 'native-session';
  const start = testDate().getTime();
  const end = testDate({ seconds: 30 }).getTime();
  let root: string;
  let project: string;
  let handles: fs.FileHandle[];

  beforeEach(async () => {
    handles = [];
    jest.mocked(fs.open).mockImplementation(async (file, flags, mode) => {
      const actual = jest.requireActual<typeof fs>('node:fs/promises');
      const handle = await actual.open(file, flags, mode);
      jest.spyOn(handle, 'read');
      handles.push(handle);
      return handle;
    });
    root = await fs.mkdtemp(path.join(tmpdir(), 'claudian-recovery-edges-'));
    project = path.join(root, 'projects', encodeVaultPathForSDK(vault));
    await fs.mkdir(project, { recursive: true });
  });

  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  function record(type: string, timestamp: string, size = 0): string {
    return JSON.stringify({ sessionId, type, timestamp, message: { content: 'x'.repeat(size) } });
  }

  async function recover(lines: string[]): Promise<string | null> {
    await fs.writeFile(path.join(project, `${sessionId}.jsonl`), lines.join('\n') + '\n');
    return recoverSDKSessionIdByTime(vault, { createdAt: start, lastActivityAt: end }, {
      environment: { CLAUDE_CONFIG_DIR: root },
    });
  }

  async function bytesRead(): Promise<number> {
    const results = await Promise.all(handles.flatMap(handle => jest.mocked(handle.read).mock.results
      .map(result => result.value as Promise<{ bytesRead: number }>)));
    return results.reduce((total, result) => total + result.bytesRead, 0);
  }

  it.each(['first', 'last'])('recovers a transcript with a large %s record crossing the sample boundary', async (edge) => {
    const first = record('user', testTime(), edge === 'first' ? 240 * 1024 : 0);
    const last = record('assistant', testTime({ seconds: 30 }), edge === 'last' ? 240 * 1024 : 0);

    await expect(recover([first, last])).resolves.toBe(sessionId);
  });

  it('retains complete edge records when a huge middle record exceeds the completion budget', async () => {
    await expect(recover([
      record('user', testTime()),
      record('progress', testTime({ seconds: 15 }), 4 * 1024 * 1024),
      record('assistant', testTime({ seconds: 30 })),
    ])).resolves.toBe(sessionId);
    expect(await bytesRead()).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('bounds reads for a giant native record with no newline', async () => {
    await fs.writeFile(path.join(project, `${sessionId}.jsonl`),
      record('assistant', testTime({ seconds: 30 }), 4 * 1024 * 1024));
    await expect(recoverSDKSessionIdByTime(vault, { createdAt: start, lastActivityAt: end }, {
      environment: { CLAUDE_CONFIG_DIR: root },
    })).resolves.toBeNull();
    const count = await bytesRead();
    expect(count).toBeGreaterThanOrEqual(128 * 1024);
    expect(count).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('reads only the edges of an ordinary multi-megabyte transcript', async () => {
    await expect(recover([
      record('user', testTime()),
      ...Array.from({ length: 20_000 }, () => record('progress', testTime({ seconds: 15 }))),
      record('assistant', testTime({ seconds: 30 })),
    ])).resolves.toBe(sessionId);
    expect(await bytesRead()).toBeLessThanOrEqual(256 * 1024);
  });
});
