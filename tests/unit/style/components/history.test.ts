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
    expect(metadataCss).toContain('background: var(--background-primary);');
    expect(metadataCss).not.toContain('body.theme-dark .claudian-session-metadata-popover');
  });
});

describe('Single-pane history action styles', () => {
  it('keeps archive navigation pinned above rows on an opaque full-width surface', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
    const archiveControlRule = css.match(/\.claudian-history-archive-control\s*{[^}]*}/)?.[0];

    expect(archiveControlRule).toContain('position: sticky;');
    expect(archiveControlRule).toContain('top: 0;');
    expect(archiveControlRule).toContain('z-index: 3;');
    expect(archiveControlRule).toContain('box-sizing: border-box;');
    expect(archiveControlRule).toContain('width: 100%;');
    expect(archiveControlRule).toContain('isolation: isolate;');
    expect(archiveControlRule).toContain('background: var(--background-primary);');
    expect(css).toMatch(
      /\.claudian-history-archive-control:hover,[\s\S]*?\.claudian-history-archive-control:focus-visible\s*{[^}]*background:\s*color-mix\(in srgb, var\(--background-primary\) 92%, var\(--text-normal\)\);/,
    );
  });

  it('anchors the home history surface below the chat header', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-home-state \.claudian-history-menu\s*{[^}]*top:\s*46px;[^}]*bottom:\s*auto;/,
    );
    expect(css).toMatch(
      /\.claudian-history-menu\s*{[^}]*border-radius:\s*16px;/,
    );
    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item\s*{[^}]*border-bottom:\s*0;/,
    );
  });

  it('replaces the timestamp with actions in the same slot on hover', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item-actions\s*{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*8px;/,
    );
    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item:hover \.claudian-history-item-date,[\s\S]*?\.claudian-history-menu \.claudian-history-item:focus-within \.claudian-history-item-date\s*{[^}]*opacity:\s*0;/,
    );
  });

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
