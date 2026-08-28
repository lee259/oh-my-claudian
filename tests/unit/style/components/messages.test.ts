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

  it('isolates assistant layout without containing user message actions', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    const messageRule = css.match(/\.claudian-message\s*{[^}]*}/)?.[0];
    expect(messageRule).not.toContain('content-visibility: auto;');

    const userRule = css.match(/\.claudian-message-user\s*{[^}]*}/)?.[0];
    expect(userRule).not.toContain('content-visibility: auto;');
    expect(userRule).not.toContain('contain-intrinsic-size:');

    const assistantRule = css.match(/\.claudian-message-assistant\s*{[^}]*}/)?.[0];
    expect(assistantRule).toContain('flex-shrink: 0;');
    expect(assistantRule).toContain('content-visibility: auto;');
    expect(assistantRule).toContain('contain-intrinsic-size: auto 23.5rem;');
  });
});
