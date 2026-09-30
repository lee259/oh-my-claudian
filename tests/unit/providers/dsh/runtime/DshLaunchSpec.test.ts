import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildDshLaunchSpec, resolveDshLaunchCommand } from '@/providers/dsh/runtime/DshLaunchSpec';

describe('DshLaunchSpec', () => {
  it('selects a dsh installed in the login PATH over an auto-discovered wrapper', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-dsh-bin-'));
    const binary = path.join(directory, 'dsh');
    fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n');
    try {
      expect(resolveDshLaunchCommand('/Users/me/.local/bin/dsh', { PATH: directory }, false)).toBe(binary);
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  it('keeps an explicitly configured executable path', () => {
    expect(resolveDshLaunchCommand(
      '/custom/dsh',
      { PATH: '/login/bin' },
      true,
    )).toBe('/custom/dsh');
  });

  it('adds the executable directory to PATH for wrapper dependencies', () => {
    const spec = buildDshLaunchSpec({
      command: '/Users/me/.local/bin/dsh',
      cwd: '/vault/project',
      env: { PATH: '/login/bin' },
    });

    expect(spec.env.PATH).toBe(['/Users/me/.local/bin', '/login/bin'].join(path.delimiter));
    expect(spec.args).toEqual(['--profile', 'acp']);
  });

  it('adds a runtime route patch only when one is provided', () => {
    expect(buildDshLaunchSpec({
      command: '/usr/local/bin/dsh',
      cwd: '/vault/project',
      env: { PATH: '/usr/local/bin' },
      profilePatchPath: '/tmp/selected-route.patch.yml',
    }).args).toEqual(['--profile', 'acp', '--patch', '/tmp/selected-route.patch.yml']);
  });
});
