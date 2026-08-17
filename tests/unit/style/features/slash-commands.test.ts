import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('slash command dropdown styles', () => {
  it('does not use backdrop filtering that can leave stale dropdown pixels', () => {
    const css = readFileSync(
      path.resolve('src/style/features/slash-commands.css'),
      'utf8',
    );

    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('-webkit-backdrop-filter');
  });
});
