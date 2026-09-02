import {
  compareVersions,
  extractVersion,
  isUpdateAvailable,
} from '@/core/providers/cli/CliVersionUtils';

describe('compareVersions', () => {
  it('compares equal versions as 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('orders by major version', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
  });

  it('orders by minor and patch', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
  });

  it('treats prerelease as older than release', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3-beta.1')).toBeGreaterThan(0);
  });

  it('compares numeric prerelease identifiers numerically', () => {
    expect(compareVersions('1.2.3-beta.2', '1.2.3-beta.10')).toBeLessThan(0);
  });

  it('compares prerelease identifiers lexically for non-numeric', () => {
    expect(compareVersions('1.2.3-alpha', '1.2.3-beta')).toBeLessThan(0);
  });

  it('returns 0 when either version cannot be parsed', () => {
    expect(compareVersions('not-a-version', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '')).toBe(0);
  });
});

describe('isUpdateAvailable', () => {
  it('is true when latest is greater than current', () => {
    expect(isUpdateAvailable('1.2.3', '1.2.4')).toBe(true);
    expect(isUpdateAvailable('1.2.3', '2.0.0')).toBe(true);
  });

  it('is false when versions are equal or current is newer', () => {
    expect(isUpdateAvailable('1.2.3', '1.2.3')).toBe(false);
    expect(isUpdateAvailable('1.2.4', '1.2.3')).toBe(false);
  });

  it('is false when either version is missing', () => {
    expect(isUpdateAvailable(null, '1.2.3')).toBe(false);
    expect(isUpdateAvailable('1.2.3', null)).toBe(false);
    expect(isUpdateAvailable(undefined, undefined)).toBe(false);
    expect(isUpdateAvailable('', '1.2.3')).toBe(false);
  });

  it('does not report a prerelease-only lead as an update', () => {
    expect(isUpdateAvailable('1.2.3-next.1', '1.2.3')).toBe(false);
  });
});

describe('extractVersion', () => {
  it('extracts a bare version', () => {
    expect(extractVersion('1.2.3')).toBe('1.2.3');
  });

  it('extracts a version from prefixed output', () => {
    expect(extractVersion('grok 2.1.156')).toBe('2.1.156');
    expect(extractVersion('claude version 1.0.45\nCopyright 2024')).toBe('1.0.45');
  });

  it('extracts a version with a prerelease tag', () => {
    expect(extractVersion('codex 0.12.0-next.3')).toBe('0.12.0-next.3');
  });

  it('returns the trimmed raw output when no version is found', () => {
    expect(extractVersion('  unknown  ')).toBe('unknown');
  });
});
