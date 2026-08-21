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
});
