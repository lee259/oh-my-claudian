jest.mock('cross-spawn', () => {
  const crossSpawn = jest.requireActual('cross-spawn') as Spawn;
  return jest.fn((command: string, args: string[], options: unknown) => {
    if (command !== 'grok-fixture') return crossSpawn(command, args, options as never);
    const fixture = `${process.cwd()}/tests/fixtures/providers/grok/runtime/GrokModelCatalogProcess.mjs`;
    return crossSpawn(process.execPath, [fixture, ...args], options as never);
  });
});

import type { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { GrokModelCatalogService } from '@/providers/grok/runtime/GrokModelCatalogService';

type Spawn = typeof spawn;

interface FixtureContext {
  directory: string;
  host: ProviderHost;
  pidFile: string;
  requestFile: string;
}

const activeContexts: FixtureContext[] = [];

describe('GrokModelCatalogService ACP discovery integration', () => {
  afterEach(async () => {
    for (const context of activeContexts) {
      await stopFixture(readPid(context.pidFile));
      await rm(context.directory, { force: true, recursive: true });
    }
    activeContexts.length = 0;
  });

  it('returns native model reasoning metadata without invoking the legacy model command', async () => {
    const context = await makeFixtureContext('native');
    const service = new GrokModelCatalogService(context.host);

    const result = await service.discoverCatalog();

    expect(result).toMatchObject({
      defaultModelId: 'grok-4.6',
      kind: 'completed',
      models: [{
        defaultReasoningEffort: 'high',
        rawId: 'grok-4.6',
        reasoningMetadataResolved: true,
        reasoningEfforts: expect.arrayContaining([
          expect.objectContaining({ value: 'xhigh' }),
        ]),
      }],
    });
    expect(await isRunning(readPid(context.pidFile))).toBe(false);
  }, 10_000);

  it('falls back to the CLI catalog when the runtime does not support the ACP query', async () => {
    const context = await makeFixtureContext('unsupported');
    const service = new GrokModelCatalogService(context.host);

    const result = await service.discoverCatalog();

    expect(result).toMatchObject({
      defaultModelId: 'legacy-model',
      kind: 'completed',
      models: [expect.objectContaining({ rawId: 'legacy-model' })],
    });
    expect(await isRunning(readPid(context.pidFile))).toBe(false);
  }, 10_000);

  it('aborts a pending ACP query and shuts down its subprocess', async () => {
    const context = await makeFixtureContext('hang');
    const controller = new AbortController();
    const service = new GrokModelCatalogService(context.host, {
      modelCommandTimeoutMs: 5_000,
    });

    const discovery = service.discoverCatalog(controller.signal);
    await waitForFile(context.requestFile);
    controller.abort();

    await expect(discovery).resolves.toMatchObject({
      diagnostics: 'Grok models was cancelled',
      kind: 'completed',
      models: [],
    });
    expect(await isRunning(readPid(context.pidFile))).toBe(false);
  }, 10_000);
});

async function makeFixtureContext(mode: string): Promise<FixtureContext> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'grok-model-catalog-'));
  const context: FixtureContext = {
    directory,
    host: {} as ProviderHost,
    pidFile: path.join(directory, 'pid'),
    requestFile: path.join(directory, 'requests'),
  };
  context.host = {
    app: { vault: { adapter: { basePath: directory } } },
    getResolvedProviderCliPath: jest.fn(async () => 'grok-fixture'),
    manifest: { version: 'test-version' },
    settings: {
      providerConfigs: {
        grok: {
          enabled: true,
          environmentVariables: [
            `GROK_FIXTURE_MODE=${mode}`,
            `GROK_FIXTURE_PID_FILE=${context.pidFile}`,
            `GROK_FIXTURE_REQUEST_FILE=${context.requestFile}`,
          ].join('\n'),
        },
      },
    },
  } as unknown as ProviderHost;
  activeContexts.push(context);
  return context;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath, 'utf8');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error('Grok fixture did not receive the model-list request');
}

function readPid(filePath: string): number | null {
  try {
    const value = readFileSync(filePath, 'utf8');
    const pid = Number(value);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function isRunning(pid: number | null): Promise<boolean> {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopFixture(pid: number | null): Promise<void> {
  if (!pid || !(await isRunning(pid))) return;
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && await isRunning(pid)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
