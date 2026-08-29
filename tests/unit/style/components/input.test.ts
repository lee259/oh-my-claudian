import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Chat input toolbar styles', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/style/components/input.css'),
    'utf8',
  );

  it('anchors the send button inside the composer and leaves room for the toolbar', () => {
    expect(css).toMatch(
      /\.claudian-input-send-button\s*\{[\s\S]*?position:\s*absolute;/,
    );
    expect(css).toMatch(
      /\.claudian-input-toolbar\s*\{[\s\S]*?padding:\s*4px 56px 8px 10px;/,
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

  it('keeps the send button hover state under upstream Claudian styles', () => {
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-send-button:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--oh-my-claudian-brand\)/,
    );
  });

  it('does not let inline mention highlighting change textarea text metrics', () => {
    expect(css).toMatch(
      /\.claudian-input-wrapper textarea\.claudian-input\s*\{[^}]*box-sizing:\s*border-box;/,
    );
    expect(css).toMatch(
      /\.claudian-input-mention-highlight\s*\{[^}]*padding:\s*0;/,
    );
    expect(css).toMatch(
      /\.claudian-input-wrapper textarea\.claudian-input\s*\{[\s\S]*?line-height:\s*1\.4;/,
    );
    expect(css).toMatch(
      /\.claudian-input-mention-highlights\s*\{[\s\S]*?line-height:\s*1\.4;/,
    );
  });
});
