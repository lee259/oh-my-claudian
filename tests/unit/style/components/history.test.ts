import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Session history styles', () => {
  it('keeps the sidebar surface switcher visible at the top', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-session-sidebar\s*{[^}]*--claudian-sidebar-surface-footer-height:\s*40px;/,
    );
    expect(css).toMatch(
      /\.claudian-sidebar-surface-switcher\s*{[^}]*position:\s*relative;[^}]*flex:\s*0 0 auto;[^}]*background:\s*var\(--background-primary\);/,
    );
  });

  it('keeps session and history rules inside the Oh My Claudian root', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toContain('.claudian-history-container');
    expect(css).toContain('body.theme-dark .claudian-session-metadata-popover');
  });
});
