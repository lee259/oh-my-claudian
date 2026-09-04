import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Session history styles', () => {
  it('keeps the sidebar surface switcher visible at the top', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).not.toMatch(/--claudian-sidebar-surface-footer-height:/);
    expect(css).toMatch(
      /\.claudian-sidebar-surface-switcher\s*{[^}]*position:\s*relative;[^}]*flex:\s*0 0 auto;[^}]*background:\s*var\(--background-primary\);/,
    );
  });

  it('keeps history rules scoped and session metadata overlay rules global', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
    const metadataCss = readFileSync(
      path.resolve('src/style/session-metadata-popover.css'),
      'utf8',
    );

    expect(css).toContain('.claudian-history-container');
    expect(css).not.toContain('.claudian-session-metadata-popover');
    expect(metadataCss).toContain('.claudian-session-metadata-popover');
    expect(metadataCss).toContain('body.theme-dark .claudian-session-metadata-popover');
  });
});

describe('Single-pane history action styles', () => {
  it('keeps row actions borderless and transparent while using color for interaction', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item-actions \.claudian-action-btn\s*{[^}]*background:\s*transparent;[^}]*border:\s*none;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--text-muted\);/,
    );
    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item-actions \.claudian-action-btn:hover,[\s\S]*?\.claudian-history-menu \.claudian-history-item-actions \.claudian-action-btn:focus-visible\s*{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--text-normal\);/,
    );
  });
});
