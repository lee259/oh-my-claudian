import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Generated coexistence styles', () => {
  it('scopes chat selectors in the built stylesheet', () => {
    execFileSync(process.execPath, ['scripts/build-css.mjs'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });

    const css = readFileSync(path.resolve('styles.css'), 'utf8');

    expect(css).toContain('.oh-my-claudian-root .claudian-session-sidebar');
    expect(css).toContain('.oh-my-claudian-root .claudian-input-container');
    expect(css).toContain('.oh-my-claudian-root .claudian-message-user');
    expect(css).not.toMatch(/(?:^|})\.claudian-session-sidebar\s*\{/);
    expect(css).not.toMatch(/(?:^|})\.claudian-input-container\s*\{/);
    expect(css).not.toMatch(/(?:^|})\.claudian-message-user\s*\{/);
  });
});
