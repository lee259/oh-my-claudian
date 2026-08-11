import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Chat input toolbar styles', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/style/components/input.css'),
    'utf8',
  );

  it('keeps the send button in toolbar flow so it cannot cover the mode selector', () => {
    expect(css).not.toMatch(
      /\.claudian-input-send-button\s*\{[\s\S]*?position:\s*absolute;/,
    );
    expect(css).toMatch(
      /\.claudian-input-send-button\s*\{[\s\S]*?margin-inline-start:\s*8px;/,
    );
  });
});
