import {
  type CliProviderMetadata,
  resolveCliInstallCommand,
  resolveCliInstallerUrl,
  resolveCliUpdateCommand,
} from '@/core/providers/cli/CliProviderMetadata';
import { cursorCliMetadata } from '@/providers/cursor/runtime/CursorCliMetadata';
import { grokCliMetadata } from '@/providers/grok/runtime/GrokCliMetadata';
import { ompCliMetadata } from '@/providers/omp/runtime/OmpCliMetadata';

const baseMetadata: CliProviderMetadata = {
  binaryName: 'claude',
  displayName: 'Claude',
};

describe('resolveCliInstallCommand', () => {
  it('falls back to npm install -g when only an npm package is known', () => {
    expect(resolveCliInstallCommand({ ...baseMetadata, npmPackage: '@anthropic-ai/claude-code' }))
      .toEqual({ command: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code@latest'] });
  });

  it.each([
    ['Cursor', cursorCliMetadata, 'https://cursor.com/install'],
    ['Grok', grokCliMetadata, 'https://x.ai/cli/install.sh'],
    ['OMP', ompCliMetadata, 'https://omp.sh/install'],
  ])('uses the official installer for %s when the CLI is missing', (_name, metadata, installerUrl) => {
    expect(resolveCliInstallCommand(metadata)).toEqual({
      command: 'bash',
      args: ['-lc', `curl -fsSL ${installerUrl} | bash`],
    });
  });

  it('returns null when no npm package or install command is defined', () => {
    expect(resolveCliInstallCommand(baseMetadata)).toBeNull();
  });

  it('prefers an explicit install command over the npm fallback', () => {
    const metadata: CliProviderMetadata = {
      ...baseMetadata,
      npmPackage: '@anthropic-ai/claude-code',
      install: { command: 'claude', args: ['install'] },
    };
    expect(resolveCliInstallCommand(metadata)).toEqual({ command: 'claude', args: ['install'] });
  });

  it('prefers a platform override over the generic install command', () => {
    const platform = process.platform;
    const metadata: CliProviderMetadata = {
      ...baseMetadata,
      npmPackage: 'pkg',
      install: { command: 'npm', args: ['install', '-g', 'pkg'] },
      platform: {
        [platform]: { install: { command: 'npm.cmd', args: ['install', '-g', 'pkg'] } },
      },
    };
    const result = resolveCliInstallCommand(metadata);
    expect(result).toEqual({ command: 'npm.cmd', args: ['install', '-g', 'pkg'] });
  });
});

describe('resolveCliUpdateCommand', () => {
  it('falls back to npm install -g @latest when only an npm package is known', () => {
    expect(resolveCliUpdateCommand({ ...baseMetadata, npmPackage: '@openai/codex' }))
      .toEqual({ command: 'npm', args: ['install', '-g', '@openai/codex@latest'] });
  });

  it('returns null when no npm package or update command is defined', () => {
    expect(resolveCliUpdateCommand(baseMetadata)).toBeNull();
  });

  it('prefers an explicit update command over the npm fallback', () => {
    const metadata: CliProviderMetadata = {
      ...baseMetadata,
      npmPackage: '@anthropic-ai/claude-code',
      update: { command: 'claude', args: ['update'] },
    };
    expect(resolveCliUpdateCommand(metadata)).toEqual({ command: 'claude', args: ['update'] });
  });

  it('prefers a platform override over the generic update command', () => {
    const platform = process.platform;
    const metadata: CliProviderMetadata = {
      ...baseMetadata,
      update: { command: 'claude', args: ['update'] },
      platform: {
        [platform]: { update: { command: 'claude.cmd', args: ['update'] } },
      },
    };
    const result = resolveCliUpdateCommand(metadata);
    expect(result).toEqual({ command: 'claude.cmd', args: ['update'] });
  });
});

describe('resolveCliInstallerUrl', () => {
  it('returns null when no installer URL is defined', () => {
    expect(resolveCliInstallerUrl(baseMetadata)).toBeNull();
  });

  it('returns the generic installer URL', () => {
    const metadata: CliProviderMetadata = {
      ...baseMetadata,
      installerUrl: 'https://example.com/install',
    };
    expect(resolveCliInstallerUrl(metadata)).toBe('https://example.com/install');
  });

  it('prefers a platform override installer URL', () => {
    const platform = process.platform;
    const metadata: CliProviderMetadata = {
      ...baseMetadata,
      installerUrl: 'https://example.com/install',
      platform: {
        [platform]: { installerUrl: 'https://example.com/mac' },
      },
    };
    const result = resolveCliInstallerUrl(metadata);
    expect(result).toBe('https://example.com/mac');
  });
});
