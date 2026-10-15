import * as fs from 'fs';
import * as path from 'path';

import { CursorCliResolver } from '@/providers/cursor/runtime/CursorCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

describe('CursorCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('prefers cursor-agent over a conflicting agent on PATH', () => {
    const cursorPath = path.join('/cursor/bin', 'cursor-agent');
    const otherAgent = path.join('/other/bin', 'agent');
    (fs.statSync as jest.Mock).mockImplementation((candidate: string) => {
      if (candidate === cursorPath || candidate === otherAgent) return { isFile: () => true };
      throw new Error('ENOENT');
    });

    expect(new CursorCliResolver().resolveFromSettings({
      providerConfigs: { cursor: { environmentVariables: `PATH=${['/other/bin', '/cursor/bin'].join(path.delimiter)}` } },
    })).toBe(cursorPath);
  });

  it('preserves explicit current-host and legacy paths ahead of automatic discovery', () => {
    (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true });
    const resolver = new CursorCliResolver();
    const settings = { providerConfigs: { cursor: {
      cliPathsByHost: { 'current-host': '/custom/agent', 'other-host': '/synced/agent' },
      cliPath: '/legacy/agent',
    } } };
    expect(resolver.resolveFromSettings(settings)).toBe('/custom/agent');
    expect(resolver.resolveFromSettings({ providerConfigs: { cursor: {
      cliPathsByHost: { 'other-host': '/synced/agent' }, cliPath: '/legacy/agent',
    } } })).toBe('/legacy/agent');
  });

  it('supports older installations with only agent and rediscovers cursor-agent after reset', () => {
    const oldPath = path.join('/cursor/bin', 'agent');
    const newPath = path.join('/cursor/bin', 'cursor-agent');
    let installed = oldPath;
    (fs.statSync as jest.Mock).mockImplementation((candidate: string) => {
      if (candidate === installed) return { isFile: () => true };
      throw new Error('ENOENT');
    });
    const settings = { providerConfigs: { cursor: { environmentVariables: 'PATH=/cursor/bin' } } };
    const resolver = new CursorCliResolver();
    expect(resolver.resolveFromSettings(settings)).toBe(oldPath);
    installed = newPath;
    expect(resolver.resolveFromSettings(settings)).toBe(oldPath);
    resolver.reset();
    expect(resolver.resolveFromSettings(settings)).toBe(newPath);
  });

  it('returns null when neither Cursor executable exists', () => {
    (fs.statSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(new CursorCliResolver().resolveFromSettings({})).toBeNull();
  });
});
