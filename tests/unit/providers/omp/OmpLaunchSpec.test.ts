import * as path from 'node:path';

import { buildOmpEnvironment, buildOmpLaunchSpec } from '@/providers/omp/runtime/OmpLaunchSpec';
import { DEFAULT_OMP_PROVIDER_SETTINGS } from '@/providers/omp/settings';

describe('buildOmpLaunchSpec', () => {
  it('does not inherit Pi configuration directories or profiles', () => {
    expect(buildOmpEnvironment(
      {
        PATH: '/usr/bin',
        PI_CODING_AGENT_DIR: '/Users/lee/.pi/agent',
        PI_PROFILE: 'pi-work',
      },
      {
        OMP_PROFILE: 'omp-work',
        PI_CONFIG_DIR: '/Users/lee/.pi',
      },
    )).toEqual({ PATH: '/usr/bin', OMP_PROFILE: 'omp-work' });
  });

  it('starts OMP in ACP mode with an explicit safe approval policy', () => {
    const spec = buildOmpLaunchSpec({
      command: '/usr/local/bin/omp',
      cwd: '/vault/project',
      env: { OMP_PROFILE: 'test', PATH: '/usr/local/bin' },
      settings: DEFAULT_OMP_PROVIDER_SETTINGS,
    });

    expect(spec).toEqual({
      args: ['acp', '--approval-mode', 'always-ask'],
      command: '/usr/local/bin/omp',
      cwd: '/vault/project',
      env: { OMP_PROFILE: 'test', PATH: '/usr/local/bin' },
    });
  });

  it.each(['always-ask', 'write', 'yolo'] as const)(
    'passes the native %s approval mode to the ACP process',
    approvalMode => {
      expect(buildOmpLaunchSpec({
        approvalMode,
        command: 'omp',
        cwd: '/vault/project',
        settings: DEFAULT_OMP_PROVIDER_SETTINGS,
      }).args).toEqual(['acp', '--approval-mode', approvalMode]);
    },
  );

  it('makes Bun available for an absolute OMP executable path', () => {
    const runtimePath = ['/usr/bin', '/bin'].join(path.delimiter);
    const spec = buildOmpLaunchSpec({
      command: '/Users/lee/.bun/bin/omp',
      cwd: '/vault/project',
      env: { PATH: runtimePath },
      settings: DEFAULT_OMP_PROVIDER_SETTINGS,
    });

    expect(spec.env.PATH).toBe(['/Users/lee/.bun/bin', runtimePath].join(path.delimiter));
  });
});
