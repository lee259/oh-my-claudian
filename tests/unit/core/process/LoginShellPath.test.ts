jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

import { execFile } from 'node:child_process';

import { getLoginShellPath, loadLoginShellPath } from '@/core/process/LoginShellPath';

it('reads only the login PATH once and ignores shell startup output', async () => {
  jest.mocked(execFile).mockImplementation(((_command: unknown, _args: unknown, _options: unknown, callback: (error: null, stdout: string) => void) => {
    callback(null, 'startup output\n__CLAUDIAN_LOGIN_PATH__/custom/bin:/usr/bin');
    return { kill: jest.fn() };
  }) as never);
  await Promise.all([loadLoginShellPath(), loadLoginShellPath()]);
  expect(getLoginShellPath()).toBe(process.platform === 'win32' ? null : '/custom/bin:/usr/bin');
  expect(execFile).toHaveBeenCalledTimes(process.platform === 'win32' ? 0 : 1);
});
