import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Chat code styles', () => {
  it('gives inline code a readable surface without styling code inside a block', () => {
    const css = readFileSync(path.resolve('src/style/components/code.css'), 'utf8');

    expect(css).toMatch(/\.claudian-container \.claudian-message-content :not\(pre\) > code\s*{[\s\S]*background-color:\s*var\(--code-background, var\(--background-secondary\)\);[\s\S]*padding:\s*0\.1em 0\.35em;/);
  });
});
