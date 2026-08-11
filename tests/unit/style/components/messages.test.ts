import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Message styles', () => {
  it('keeps ordered-list markers readable in user messages', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-message-user ol > li::marker\s*{\s*color:\s*inherit;\s*}/,
    );
  });

  it('uses an Oh My Claudian-owned brand variable for user bubbles', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-message-user\s*\{[\s\S]*?background:\s*rgba\(var\(--oh-my-claudian-brand-rgb\), 0\.16\);/,
    );
  });
});
