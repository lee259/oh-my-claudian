import { supportsCodexReviewGrants } from '@/providers/codex/runtime/codexAppServerSupport';

describe('supportsCodexReviewGrants', () => {
  it.each([
    ['codex-cli/0.172.0', true],
    ['codex-cli/0.124.0', true],
    ['codex-cli/0.123.9', false],
    ['codex/1.0.0', true],
    ['codex-cli/0.124.0 (macos)', true],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%s -> %s', (userAgent, expected) => {
    expect(supportsCodexReviewGrants(userAgent)).toBe(expected);
  });
});
