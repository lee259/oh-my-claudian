import type { AcpSessionNotification } from '@/providers/acp';
import { OmpCommandMetadataProbe } from '@/providers/omp/app/OmpCommandMetadataProbe';
import type {
  OmpAcpSessionKernel,
  OmpAcpSessionKernelOptions,
} from '@/providers/omp/execution/OmpAcpSessionKernel';

function createKernel(
  options: OmpAcpSessionKernelOptions,
  advertise: (notify: (notification: AcpSessionNotification) => void) => void,
): OmpAcpSessionKernel & { dispose: jest.Mock } {
  return {
    cancel: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
    openSession: jest.fn(async () => {
      advertise(options.onNotification);
      return { sessionId: 'probe-session' };
    }),
    prompt: jest.fn(),
    setConfigOption: jest.fn(),
    setModel: jest.fn(),
  };
}

function createHost() {
  return {
    app: { vault: { adapter: { basePath: '/vault' } } },
    settings: {},
  } as never;
}

describe('OmpCommandMetadataProbe', () => {
  it('returns native commands and skills advertised after session creation', async () => {
    let kernelOptions: OmpAcpSessionKernelOptions | undefined;
    let kernel: ReturnType<typeof createKernel> | undefined;
    const probe = new OmpCommandMetadataProbe(createHost(), {
      createKernel: (options) => {
        kernelOptions = options;
        kernel = createKernel(options, notify => notify({
          sessionId: 'probe-session',
          update: {
            availableCommands: [
              { description: 'Show current model selection', name: 'model' },
              { description: 'Test-driven development', name: 'skill:tdd' },
            ],
            sessionUpdate: 'available_commands_update',
          },
        }));
        return kernel;
      },
    });

    await expect(probe.load()).resolves.toEqual([
      expect.objectContaining({ kind: 'command', name: 'model' }),
      expect.objectContaining({ kind: 'skill', name: 'skill:tdd' }),
    ]);
    expect(kernelOptions?.isolateNativeSessions).toBe(true);
    expect(kernel?.dispose).toHaveBeenCalledTimes(1);
  });

  it('ignores command updates for another native session', async () => {
    const probe = new OmpCommandMetadataProbe(createHost(), {
      commandTimeoutMs: 10,
      createKernel: options => createKernel(options, notify => notify({
        sessionId: 'other-session',
        update: {
          availableCommands: [{ description: 'Stale', name: 'stale' }],
          sessionUpdate: 'available_commands_update',
        },
      })),
    });

    await expect(probe.load()).rejects.toThrow('OMP did not advertise commands');
  });

  it('releases the probe process when the caller aborts', async () => {
    let kernel: ReturnType<typeof createKernel> | undefined;
    const controller = new AbortController();
    const probe = new OmpCommandMetadataProbe(createHost(), {
      createKernel: (options) => {
        kernel = createKernel(options, () => controller.abort(new Error('cancelled')));
        return kernel;
      },
    });

    await expect(probe.load(controller.signal)).rejects.toThrow();
    expect(kernel?.dispose).toHaveBeenCalled();
  });
});
