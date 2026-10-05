import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('slash command dropdown styles', () => {
  it('avoids backdrop filtering on the dropdown rule', () => {
    const css = readFileSync(
      path.resolve('src/style/features/slash-commands.css'),
      'utf8',
    );
    const dropdownRule = css.match(/\.claudian-slash-dropdown\s*{([^}]*)}/)?.[1];

    expect(dropdownRule).toBeDefined();
    expect(dropdownRule).toContain('background: var(--background-secondary);');
    expect(dropdownRule).not.toContain('backdrop-filter');
    expect(dropdownRule).not.toContain('-webkit-backdrop-filter');
  });

  it('distinguishes command and skill types and keeps keyboard selection visible', () => {
    const css = readFileSync(
      path.resolve('src/style/features/slash-commands.css'),
      'utf8',
    );

    expect(css).toMatch(/\.claudian-slash-kind\s*\{[^}]*margin-inline-start:\s*auto;/);
    expect(css).toMatch(/\.claudian-slash-kind--skill\s*\{[^}]*color:\s*var\(--interactive-accent\);/);
    expect(css).toMatch(/\.claudian-slash-item\.selected\s*\{[^}]*border-inline-start:\s*2px solid var\(--interactive-accent\);/);
    expect(css).toMatch(/\.claudian-slash-item\s*\{[^}]*padding:\s*10px 12px;/);
    expect(css).toMatch(/\.claudian-slash-hint\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  });
});
