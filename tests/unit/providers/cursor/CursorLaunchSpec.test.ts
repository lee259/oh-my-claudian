import * as path from 'node:path';

import { buildCursorLaunchSpec } from '@/providers/cursor/runtime/CursorLaunchSpec';

describe('buildCursorLaunchSpec', () => {
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
