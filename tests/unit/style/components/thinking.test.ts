import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Thinking styles', () => {
  it('uses the normal thinking color while compacting', () => {
    const thinking = readFileSync(path.resolve('src/style/components/thinking.css'), 'utf8');
    const variables = readFileSync(path.resolve('src/style/base/variables.css'), 'utf8');

    expect(thinking).not.toMatch(/\.claudian-thinking--compact\s*\{[^}]*color\s*:/);
    expect(variables).not.toContain('--claudian-compact:');
  });
});
