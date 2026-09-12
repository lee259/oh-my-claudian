import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Message styles', () => {
  it('keeps ordered-list markers readable in user messages', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-message-user ol > li::marker\s*{\s*color:\s*inherit;\s*}/,
    );
  });

  it('applies the Oh My Claudian brand surface to user message content only', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-message-user > \.claudian-message-content\s*\{[\s\S]*?background:\s*rgba\(var\(--oh-my-claudian-brand-rgb\), 0\.16\);/,
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

  it('disables assistant layout isolation on Windows only', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(/body\.mod-windows \.claudian-message-assistant\s*{[^}]*content-visibility:\s*visible;[^}]*contain-intrinsic-size:\s*none;/);
  });

  it('keeps user action rows out of bubble sizing and reveals them on hover', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(/\.claudian-message-user\s*{[^}]*padding:\s*0;/);
    expect(css).toMatch(/\.claudian-message-user > \.claudian-message-content\s*{[^}]*padding:\s*10px 14px;/);
    expect(css).toMatch(/\.claudian-message-action-row\s*{[^}]*display:\s*flex;[^}]*margin-top:\s*8px;/);
    expect(css).toMatch(/\.claudian-message-user > \.claudian-message-actions\s*{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*0;/);
    expect(css).toMatch(/\.claudian-message-user::after\s*{[^}]*height:\s*8px;/);
    expect(css).toMatch(/\.claudian-message-actions\s*{[^}]*pointer-events:\s*none;/);
    expect(css).toMatch(
      /\.claudian-message:hover > \.claudian-message-actions,[\s\S]*?\.claudian-message:focus-within > \.claudian-message-actions\s*{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/,
    );
  });
});
