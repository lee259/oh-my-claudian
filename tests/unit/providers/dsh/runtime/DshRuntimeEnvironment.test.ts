import {
  mergeDshRuntimeEnvironment,
  parseDshLoginShellEnvironment,
} from '@/providers/dsh/runtime/DshRuntimeEnvironment';

describe('DshRuntimeEnvironment', () => {
  it('reads exports after the login environment marker', () => {
    expect(parseDshLoginShellEnvironment('profile output\0__CLAUDIAN_DSH_LOGIN_ENV__\0PATH=/tools/bin\0FNM_MULTISHELL_PATH=/tools\0')).toEqual({
      FNM_MULTISHELL_PATH: '/tools',
      PATH: '/tools/bin',
    });
  });

  it('keeps login-shell tools available while configured variables take precedence', () => {
    expect(mergeDshRuntimeEnvironment(
      { PATH: '/gui/bin', SHARED: 'inherited' },
      { PATH: '/login/bin', SHARED: 'login', LOGIN_ONLY: 'yes' },
      { SHARED: 'configured', DSH_API_KEY: 'secret' },
    )).toEqual({
      DSH_API_KEY: 'secret',
      DSH_TELEMETRY_MODE: 'DISABLED',
      LOGIN_ONLY: 'yes',
      PATH: '/login/bin',
      SHARED: 'configured',
    });
  });
});
