import { execFileSync } from 'node:child_process';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findCliBinaryPath, resolveConfiguredCliPath } from '@/utils/cliBinaryLocator';
import { getEnhancedPath } from '@/utils/env';

describe('cliBinaryLocator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-binary-locator-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves configured CLI files', () => {
    const cliPath = path.join(tempDir, 'pi');
    fs.writeFileSync(cliPath, '');

    expect(resolveConfiguredCliPath(cliPath)).toBe(cliPath);
  });

  it('resolves a configured CLI path that was pasted with surrounding quotes', () => {
    const binDir = path.join(tempDir, 'my tools');
    const cliPath = path.join(binDir, 'pi');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(cliPath, '');

    expect(resolveConfiguredCliPath(`"${cliPath}"`)).toBe(cliPath);
  });

  it('finds Windows npm .cmd shims on a PATH entry', () => {
    const binDir = path.join(tempDir, 'bin');
    const shimPath = path.join(binDir, 'pi.cmd');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(shimPath, '');

    expect(findCliBinaryPath('pi', binDir, 'win32')).toBe(shimPath);
  });

  it('discovers and launches a CLI from the default mise shims directory', () => {
    const originalEnv = { ...process.env };
    const isWindows = process.platform === 'win32';
    try {
      process.env.PATH = '';
      process.env.HOME = tempDir;
      process.env.USERPROFILE = tempDir;
      delete process.env.MISE_SHIMS_DIR;
      delete process.env.MISE_DATA_DIR;
      delete process.env.XDG_DATA_HOME;
      delete process.env.LOCALAPPDATA;

      const shims = isWindows
        ? path.join(tempDir, 'AppData', 'Local', 'mise', 'shims')
        : path.join(tempDir, '.local', 'share', 'mise', 'shims');
      fs.mkdirSync(shims, { recursive: true });
      const binaryName = 'claudian-mise-probe';
      const executable = path.join(shims, `${binaryName}${isWindows ? '.exe' : ''}`);
      if (isWindows) fs.copyFileSync(process.execPath, executable);
      else fs.symlinkSync(process.execPath, executable);

      expect(findCliBinaryPath(binaryName)).toBe(executable);
      const enhancedPath = getEnhancedPath();
      expect(enhancedPath.split(path.delimiter)).toContain(shims);
      expect(execFileSync(binaryName, ['-p', '"mise probe ok"'], {
        cwd: tempDir,
        env: { ...process.env, PATH: enhancedPath },
        encoding: 'utf8',
      }).trim()).toBe('mise probe ok');
    } finally {
      Object.keys(process.env).forEach(key => delete process.env[key]);
      Object.assign(process.env, originalEnv);
    }
  });
});
