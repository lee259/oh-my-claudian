/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Message styles', () => {
  it('lets expanded streaming work grow in the chat scroll container', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');
    const historyRule = css.match(/\.claudian-streaming-work-history\s*{[^}]*}/)?.[0];

    expect(historyRule).toBeDefined();
    expect(historyRule).not.toMatch(/(?:max-height|overflow(?:-y)?|overscroll-behavior(?:-y)?):/);
  });

  it('keeps ordered-list markers readable in user messages', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-message-user ol\s*{[^}]*list-style-position:\s*inside;/,
    );
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

  it('keeps user message actions outside layout containment', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    const messageRule = css.match(/\.claudian-message\s*{[^}]*}/)?.[0];
    expect(messageRule).not.toContain('content-visibility: auto;');

    const userRule = css.match(/\.claudian-message-user\s*{[^}]*}/)?.[0];
    expect(userRule).not.toContain('content-visibility: auto;');
    expect(userRule).not.toContain('contain-intrinsic-size:');

    const assistantRule = css.match(/\.claudian-message-assistant\s*{[^}]*}/)?.[0];
    expect(assistantRule).toContain('flex-shrink: 0;');
  });

  it('uses a responsive centered assistant column on wide views', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');
    const assistantRule = css.match(/\.claudian-message-assistant\s*{[^}]*}/)?.[0];

    expect(assistantRule).toContain('width: min(100%, 960px);');
    expect(assistantRule).toContain('max-width: 100%;');
    expect(assistantRule).toContain('align-self: center;');
    expect(assistantRule).not.toContain('max-width: 72ch;');
  });

  it.each([
    ['Windows', 'mod-windows'],
    ['macOS', 'mod-macos'],
    ['Linux', 'mod-linux'],
  ])('does not skip offscreen assistant layout on %s', (_platform, platformClass) => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.className = platformClass;
    const message = document.createElement('div');
    message.className = 'claudian-message claudian-message-assistant';
    document.body.appendChild(message);

    try {
      const computed = window.getComputedStyle(message);
      expect(['', 'visible']).toContain(computed.getPropertyValue('content-visibility'));
      expect(['', 'none']).toContain(computed.getPropertyValue('contain-intrinsic-size'));
    } finally {
      message.remove();
      style.remove();
      document.body.className = '';
    }
  });

  it('keeps user action rows out of bubble sizing and reveals them on hover', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(/\.claudian-message-user\s*{[^}]*padding:\s*0;/);
    expect(css).toMatch(/\.claudian-message-user\s*{[^}]*padding-block-end:\s*36px;[^}]*margin-block-end:\s*0;/);
    expect(css).toMatch(/\.claudian-message-user > \.claudian-message-content\s*{[^}]*padding:\s*10px 14px;/);
    expect(css).toMatch(/\.claudian-message-action-row\s*{[^}]*display:\s*flex;[^}]*margin-top:\s*4px;/);
    expect(css).toMatch(/\.claudian-message-user > \.claudian-message-actions\s*{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*0;/);
    expect(css).not.toContain('.claudian-message-user::after');
    expect(css).toMatch(/\.claudian-message-actions\s*{[^}]*pointer-events:\s*none;/);
    expect(css).toMatch(
      /\.claudian-message:hover > \.claudian-message-actions,[\s\S]*?\.claudian-message-actions:focus-within\s*{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/,
    );
  });

  it('replaces a recent-conversation timestamp with its archive action in place', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-home-conversation-archive\s*{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*8px;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(
      /\.claudian-home-conversation:hover \.claudian-home-conversation-archive,[\s\S]*?\.claudian-home-conversation:focus-within \.claudian-home-conversation-archive\s*{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/,
    );
    expect(css).toMatch(
      /\.claudian-home-conversation:hover \.claudian-home-conversation-time,[\s\S]*?\.claudian-home-conversation:focus-within \.claudian-home-conversation-time\s*{[^}]*opacity:\s*0;/,
    );
  });

  it('hides the home title spinner while the archive action replaces the timestamp', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');

    expect(css).toMatch(
      /\.claudian-home-conversation:hover \.claudian-home-conversation-loading,[\s\S]*?\.claudian-home-conversation:focus-within \.claudian-home-conversation-loading\s*{[^}]*display:\s*none;/,
    );
  });
});

describe('Message table overflow', () => {
  it('clips message overflow while keeping code blocks scrollable and table cells wrappable', () => {
    const css = readFileSync(path.resolve('src/style/components/messages.css'), 'utf8');
    const codeCss = readFileSync(path.resolve('src/style/components/code.css'), 'utf8');
    const messageRule = [...css.matchAll(/\.claudian-message-content\s*{[^}]*}/g)]
      .map(match => match[0])
      .find(rule => rule.includes('overflow-x: clip;'));
    const codeBlockRule = codeCss.match(/\.claudian-message-content pre\s*{[^}]*}/)?.[0];
    const cellRule = css.match(/\.claudian-message-content th,\s*\.claudian-message-content td\s*{[^}]*}/)?.[0];

    expect(messageRule).toContain('overflow-x: clip;');
    expect(codeBlockRule).toContain('overflow-x: auto;');
    expect(cellRule).toContain('overflow-wrap: break-word;');
    expect(cellRule).toContain('white-space: normal;');
  });
});
