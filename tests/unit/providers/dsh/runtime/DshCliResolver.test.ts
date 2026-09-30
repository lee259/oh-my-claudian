const mockFindCliBinaryPath = jest.fn((binaryName: string) => (
  binaryName === 'dsh' ? '/tools/dsh' : null
));
const mockResolveConfiguredCliPath = jest.fn((value: string | undefined) => value || null);

jest.mock('../../../../../src/utils/cliBinaryLocator', () => ({
  findCliBinaryPath: (binaryName: string) => mockFindCliBinaryPath(binaryName),
  resolveConfiguredCliPath: (value: string | undefined) => mockResolveConfiguredCliPath(value),
}));

import { DshCliResolver } from '../../../../../src/providers/dsh/runtime/DshCliResolver';

describe('DshCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('discovers the dsh command on PATH when no custom path is saved', () => {
    expect(new DshCliResolver().resolveFromSettings({})).toBe('/tools/dsh');
    expect(mockFindCliBinaryPath).toHaveBeenCalledWith('dsh');
  });

  it('falls back to dsh when a stale setting points at npm or npx', () => {
    expect(new DshCliResolver().resolveFromSettings({
      providerConfigs: { dsh: { cliPath: '/node/bin/npx' } },
    })).toBe('/tools/dsh');
    expect(mockFindCliBinaryPath).toHaveBeenCalledWith('dsh');
  });

  it('keeps a configured dsh executable path', () => {
    expect(new DshCliResolver().resolveFromSettings({
      providerConfigs: { dsh: { cliPath: '/custom/bin/dsh' } },
    })).toBe('/custom/bin/dsh');
  });
});
