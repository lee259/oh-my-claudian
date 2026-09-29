import * as path from 'node:path';

import { buildCursorLaunchSpec } from '@/providers/cursor/runtime/CursorLaunchSpec';

describe('buildCursorLaunchSpec', () => {
  it('appends configured literal arguments after ACP mode', () => {
    expect(buildCursorLaunchSpec({
      additionalArguments: ['--profile', 'custom profile'],
      command: 'agent',
      cwd: '/vault/project',
    }).args).toEqual(['acp', '--profile', 'custom profile']);
  });

  it('starts Cursor Agent in ACP mode in the conversation workspace', () => {
    const runtimePath = ['/usr/bin', '/bin'].join(path.delimiter);
    expect(buildCursorLaunchSpec({
      command: '/Users/test/.local/bin/agent',
      cwd: '/vault/project',
      env: { CURSOR_API_KEY: 'secret', PATH: runtimePath },
    })).toEqual({
      args: ['acp'],
      command: '/Users/test/.local/bin/agent',
      cwd: '/vault/project',
      env: {
        CURSOR_API_KEY: 'secret',
        PATH: ['/Users/test/.local/bin', runtimePath].join(path.delimiter),
      },
    });
  });
});
