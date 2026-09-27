import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findClaudeCLIPath } from '@/providers/claude/cli/findClaudeCLIPath';
import { resolveClaudeCliPath } from '@/providers/claude/runtime/ClaudeCliResolver';

jest.mock('@/providers/claude/cli/findClaudeCLIPath', () => ({
  findClaudeCLIPath: jest.fn(),
}));

describe('resolveClaudeCliPath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-resolver-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createExecutable = (...segments: string[]): string => {
    const filePath = path.join(tempDir, ...segments);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
    return filePath;
  };

  it('resolves a configured CLI path that was pasted with surrounding quotes', () => {
    const cliPath = createExecutable('my tools', 'claude');

    expect(resolveClaudeCliPath(`"${cliPath}"`, '', '')).toBe(cliPath);
  });

  it('does not fall back to PATH discovery when the configured path is quoted', () => {
    const configured = createExecutable('configured dir', 'claude');
    const discoverable = createExecutable('path dir', 'claude');
    const envText = `PATH=${path.dirname(discoverable)}`;

    expect(resolveClaudeCliPath(`"${configured}"`, '', envText)).toBe(configured);
  });

  it('resolves a quoted legacy CLI path when no host-scoped path is set', () => {
    const cliPath = createExecutable('legacy dir', 'claude');

    expect(resolveClaudeCliPath('', `"${cliPath}"`, '')).toBe(cliPath);
  });

  it('still resolves an unquoted configured path', () => {
    const cliPath = createExecutable('plain', 'claude');

    expect(resolveClaudeCliPath(cliPath, '', '')).toBe(cliPath);
  });

  it('discovers mise-managed Claude installs when the shell PATH is unavailable', () => {
    const originalEnvironment = { ...process.env };
    const shims = path.join(tempDir, 'mise', 'shims');
    const cliPath = path.join(shims, 'claude');
    const findPath = jest.mocked(findClaudeCLIPath);
    try {
      process.env.HOME = tempDir;
      process.env.USERPROFILE = tempDir;
      process.env.PATH = '';
      process.env.MISE_SHIMS_DIR = shims;
      findPath.mockReturnValueOnce(null).mockReturnValueOnce(cliPath);

      expect(resolveClaudeCliPath('', '', 'PATH=')).toBe(cliPath);
      expect(findPath).toHaveBeenNthCalledWith(1, '');
      expect(findPath.mock.calls[1][0]?.split(path.delimiter)).toContain(shims);
    } finally {
      findPath.mockReset();
      Object.keys(process.env).forEach(key => delete process.env[key]);
      Object.assign(process.env, originalEnvironment);
    }
  });
});
