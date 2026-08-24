import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveExistingOpencodeDatabasePath,
  resolveOpencodeDatabasePath,
  resolveOpencodeDataDir,
} from '../../../../src/providers/opencode/runtime/OpencodePaths';

describe('OpencodePaths', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('prefers XDG data directories for OpenCode data', () => {
    expect(resolveOpencodeDataDir({
      HOME: '/home/tester',
      XDG_DATA_HOME: '/tmp/xdg-data',
    } as NodeJS.ProcessEnv)).toBe('/tmp/xdg-data/opencode');
  });

  it('uses the home data directory on Windows even when AppData paths are available', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const env = {
      APPDATA: '/windows/app-data',
      HOME: '/home/tester',
      LOCALAPPDATA: '/windows/local-app-data',
    } as NodeJS.ProcessEnv;

    expect(resolveOpencodeDataDir(env)).toBe('/home/tester/.local/share/opencode');
    expect(resolveOpencodeDatabasePath(env)).toBe('/home/tester/.local/share/opencode/opencode.db');
  });

  it('preserves explicit data and database overrides on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const env = {
      HOME: '/home/tester',
      OPENCODE_DB: '/custom/opencode.db',
      XDG_DATA_HOME: '/xdg/data',
    } as NodeJS.ProcessEnv;

    expect(resolveOpencodeDataDir(env)).toBe('/xdg/data/opencode');
    expect(resolveOpencodeDatabasePath(env)).toBe('/custom/opencode.db');
    expect(resolveOpencodeDatabasePath({
      ...env,
      OPENCODE_DB: 'opencode-work.db',
    })).toBe('/xdg/data/opencode/opencode-work.db');
  });

  it('falls back to the existing resolved database when persisted metadata points at a missing path', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-opencode-paths-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const dbDir = path.join(xdgDataHome, 'opencode');
    const dbPath = path.join(dbDir, 'opencode.db');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, '');

    const env = {
      HOME: path.join(tmpRoot, 'home'),
      XDG_DATA_HOME: xdgDataHome,
    } as NodeJS.ProcessEnv;

    expect(resolveOpencodeDatabasePath(env)).toBe(dbPath);
    expect(resolveExistingOpencodeDatabasePath('/missing/opencode.db', env)).toBe(dbPath);
  });
});
