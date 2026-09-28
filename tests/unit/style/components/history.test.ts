import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Session history styles', () => {
  it('contains no removed session-sidebar or metadata-popover styles', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).not.toMatch(/claudian-(?:session-sidebar|session-resizer|sidebar-surface|session-group|session-metadata-popover)/);
    expect(css).toContain('.claudian-history-container');
    expect(css).toContain('.claudian-history-menu');
  });

  it('keeps history search compact and free of a filled field surface', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-home-history-search\s*{[^}]*padding:\s*4px 8px;[^}]*background:\s*transparent;/,
    );
    expect(css).not.toMatch(/\.claudian-home-history-search:focus-within\s*{/);
    expect(css).not.toMatch(/\.claudian-home-history-search(?::focus-within)?\s*{[^}]*border-bottom/);
    expect(css).toMatch(
      /\.claudian-home-history-search input\.claudian-home-history-search-input:focus\s*{[^}]*border:\s*0;[^}]*outline:\s*none;[^}]*box-shadow:\s*none;[^}]*background:\s*transparent;/,
    );
  });
});

describe('Single-pane history action styles', () => {
  it('highlights matching history search text with the theme accent', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
    const matchRule = css.match(/\.claudian-history-search-match\s*{[^}]*}/)?.[0];

    expect(matchRule).toContain('border-radius: 2px;');
    expect(matchRule).toContain(
      'background: color-mix(in srgb, var(--interactive-accent) 24%, transparent);',
    );
    expect(matchRule).toContain('color: inherit;');
  });

  it('removes hover background from history rows without hiding their actions', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item:hover\s*{[^}]*background:\s*transparent;/,
    );
    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item\.active:hover,[\s\S]*?\.claudian-history-menu \.claudian-history-item\.open:hover\s*{[^}]*background:\s*var\(--background-modifier-hover\);/,
    );
  });

  it('renders the archived-session count as a compact pill', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
    const countRule = css.match(/\.claudian-history-archive-count\s*{[^}]*}/)?.[0];

    expect(countRule).toContain('border-radius: 999px;');
    expect(countRule).toContain('background: var(--background-modifier-hover);');
    expect(countRule).toContain('text-align: center;');
  });

  it('animates the live session running indicator', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
    const runningIndicatorRule = css.match(
      /\.claudian-session-running-indicator\s+svg\s*{[^}]*}/,
    )?.[0];

    expect(runningIndicatorRule).toContain('animation: spin 1s linear infinite;');
  });

  it('keeps expanded archived sessions within the parent history scroller', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-history-archive-section > \.claudian-history-list\s*{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/,
    );
  });

  it('styles the archive navigation as a full-width list row', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');
    const archiveControlRule = css.match(/\.claudian-history-archive-control\s*{[^}]*}/)?.[0];

    expect(archiveControlRule).toContain('box-sizing: border-box;');
    expect(archiveControlRule).toContain('width: 100%;');
    expect(archiveControlRule).toContain('background: transparent;');
    const archiveControlInteractionRule = css.match(
      /\.claudian-history-archive-control:hover,[\s\S]*?\.claudian-history-archive-control:focus-visible\s*{[^}]*}/,
    )?.[0];
    expect(archiveControlInteractionRule).not.toContain('background:');
    expect(archiveControlInteractionRule).toContain('color: var(--text-normal);');
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

  it('replaces the running indicator with actions while the history menu row is hovered', () => {
    const css = readFileSync(path.resolve('src/style/components/history.css'), 'utf8');

    for (const statusClass of [
      'claudian-session-running-indicator',
      'claudian-action-loading',
    ]) {
      expect(css).toContain(
        `.claudian-history-menu .claudian-history-item:hover .${statusClass},`,
      );
      expect(css).toContain(
        `.claudian-history-menu .claudian-history-item:focus-within .${statusClass}`,
      );
    }
    expect(css).toMatch(
      /\.claudian-history-menu \.claudian-history-item:hover \.claudian-action-loading,[\s\S]*?\{\s*display: none;/,
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
