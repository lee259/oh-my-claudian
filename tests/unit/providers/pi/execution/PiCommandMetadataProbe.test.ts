import type { ProviderHost } from '@/core/providers/ProviderHost';
import { PiCommandMetadataProbe } from '@/providers/pi/execution/PiCommandMetadataProbe';

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

describe('PiCommandMetadataProbe', () => {
  it('registers a load before a synchronously started transition quiesces', async () => {
    const cliResolution = new Deferred<string | null>();
    const kernel = {
      request: jest.fn(async () => ({ commands: [] })),
      shutdown: jest.fn(async () => undefined),
      start: jest.fn(),
    };
    const createKernel = jest.fn(() => kernel as any);
    const host = {
      getResolvedProviderCliPath: jest.fn(() => cliResolution.promise),
      settings: {},
    } as unknown as ProviderHost;
    const probe = new PiCommandMetadataProbe(host, createKernel);

    const load = probe.load('/vault');
    probe.beginEnvironmentTransition();
    let quiesced = false;
    const quiescence = probe.quiesceForEnvironmentChange().then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(quiesced).toBe(false);
    cliResolution.resolve('/configured/pi');
    await expect(load).rejects.toThrow();
    await quiescence;
    expect(createKernel).not.toHaveBeenCalled();

    probe.endEnvironmentTransition();
    await probe.dispose();
  });

  it('normalizes a non-Error abort reason while waiting behind a transition fence', async () => {
    const createKernel = jest.fn();
    const probe = new PiCommandMetadataProbe(
      {} as ProviderHost,
      createKernel,
    );
    const controller = new AbortController();
    probe.beginEnvironmentTransition();

    const load = probe.load('/vault', controller.signal);
    controller.abort('caller cancelled');

    await expect(load).rejects.toMatchObject({
      cause: 'caller cancelled',
      message: 'Pi command metadata probe aborted',
    });
    expect(createKernel).not.toHaveBeenCalled();
    await probe.dispose();
  });

  it('falls back to a pushed command catalog when get_commands is unsupported', async () => {
    const kernel = {
      request: jest.fn(async () => {
        throw new Error('Request timeout: get_commands (10000ms)');
      }),
      shutdown: jest.fn(async () => undefined),
      start: jest.fn(),
    };
    const createKernel = jest.fn((_spec, callbacks) => {
      queueMicrotask(() => callbacks.onEvent({
        commands: [
          { name: 'skill:project-probe', source: 'skill' },
          { description: 'Run tests', name: 'test', source: 'runtime' },
        ],
        type: 'available_commands_update',
      }));
      return kernel as any;
    });
    const host = {
      getResolvedProviderCliPath: jest.fn(async () => '/bin/pi'),
      settings: {},
    } as unknown as ProviderHost;
    const probe = new PiCommandMetadataProbe(host, createKernel);

    await expect(probe.load('/vault')).resolves.toEqual([
      expect.objectContaining({
        id: 'pi:skill:skill:project-probe',
        kind: 'skill',
        name: 'skill:project-probe',
      }),
      expect.objectContaining({
        id: 'pi:runtime:test',
        kind: 'command',
        name: 'test',
      }),
    ]);
    expect(kernel.request).toHaveBeenCalledWith(
      'get_commands',
      {},
      10_000,
      expect.any(AbortSignal),
    );
    await probe.dispose();
  });

  it('rethrows the get_commands failure when no pushed catalog is available', async () => {
    const kernel = {
      request: jest.fn(async () => {
        throw new Error('Request timeout: get_commands (10000ms)');
      }),
      shutdown: jest.fn(async () => undefined),
      start: jest.fn(),
    };
    const createKernel = jest.fn(() => kernel as any);
    const host = {
      getResolvedProviderCliPath: jest.fn(async () => '/bin/pi'),
      settings: {},
    } as unknown as ProviderHost;
    const probe = new PiCommandMetadataProbe(host, createKernel);

    await expect(probe.load('/vault')).rejects.toThrow(
      'Request timeout: get_commands (10000ms)',
    );
    await probe.dispose();
  });
});
