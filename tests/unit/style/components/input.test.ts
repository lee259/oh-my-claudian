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

  it('scopes the composer override for coexistence with upstream Claudian', () => {
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-send-button\s*\{[\s\S]*?position:\s*static;[\s\S]*?margin-inline-start:\s*8px;/,
    );
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-toolbar > \.claudian-mode-selector\s*\{[\s\S]*?margin-inline-start:\s*auto;/,
    );
  });

  it('uses Oh My Claudian-owned brand variables for the send button', () => {
    expect(css).toContain('background: var(--oh-my-claudian-brand);');
  });

  it('keeps the streaming stop icon visible under upstream Claudian styles', () => {
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-send-button\.is-streaming\s*\{[\s\S]*?color:\s*var\(--oh-my-claudian-brand\);/,
    );
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-send-button svg\s*\{[\s\S]*?display:\s*block;/,
    );
  });
});
