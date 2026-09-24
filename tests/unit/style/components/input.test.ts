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

  it('keeps context actions in a compact, consistently interactive popover', () => {
    expect(css).toMatch(
      /\.claudian-context-actions-menu\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?min-width:\s*min\(184px, calc\(100vw - 24px\)\);[\s\S]*?padding:\s*4px;[\s\S]*?border-radius:\s*8px;/,
    );
    expect(css).toMatch(
      /\.claudian-context-actions-menu\s*\{[\s\S]*?background:\s*var\(--background-secondary\);/,
    );
    expect(css).toMatch(
      /\.claudian-context-action-button\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*flex-start;[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*32px;/,
    );
    expect(css).toMatch(
      /\.claudian-context-actions-menu \.claudian-context-action-button\s*\{[\s\S]*?color:\s*var\(--text-normal\);/,
    );
    expect(css).toMatch(
      /\.claudian-context-actions-menu \.claudian-context-action-button:hover[\s\S]*?background:\s*var\(--background-modifier-hover\);/,
    );
    expect(css).toMatch(
      /\.claudian-context-action-button:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--interactive-accent\);/,
    );
    expect(css).toMatch(
      /\.claudian-context-action-section--external \.claudian-external-context-selector\s*\{[\s\S]*?width:\s*auto;/,
    );
    expect(css).toMatch(
      /\.claudian-context-action-section--external \.claudian-external-context-picker\s*\{[\s\S]*?min-height:\s*32px;/,
    );
    const externalContextCss = fs.readFileSync(
      path.join(process.cwd(), 'src/style/toolbar/external-context.css'),
      'utf8',
    );
    expect(externalContextCss).not.toMatch(
      /\.claudian-external-context-selector:hover \.claudian-external-context-dropdown/,
    );
    expect(externalContextCss).toMatch(
      /\.claudian-external-context-dropdown\[hidden\]\s*\{\s*display:\s*none;/,
    );
    expect(externalContextCss).toMatch(/\.claudian-external-context-item\s*\{[\s\S]*?display:\s*grid;/);
  });

  it('keeps an inactive prompt suggestion from occupying composer space', () => {
    expect(css).toMatch(
      /\.claudian-prompt-suggestion\[hidden\]\s*\{[^}]*display:\s*none;/,
    );
  });

  it('scopes the composer override for coexistence with upstream Claudian', () => {
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-send-button\s*\{[\s\S]*?position:\s*static;[\s\S]*?margin-inline-start:\s*8px;/,
    );
    expect(css).toMatch(
      /\.oh-my-claudian-root \.claudian-input-toolbar-execution-group\s*\{[\s\S]*?margin-inline-start:\s*auto;/,
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

  it('uses the mirrored layer as the visible text when mentions are highlighted', () => {
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
    expect(css).toMatch(
      /\.claudian-input-wrapper textarea\.claudian-input\s*\{[\s\S]*?color:\s*transparent\s*!important;/,
    );
    expect(css).toMatch(
      /\.claudian-input-wrapper textarea\.claudian-input\s*\{[\s\S]*?-webkit-text-fill-color:\s*transparent\s*!important;/,
    );
    expect(css).toMatch(
      /\.claudian-input-wrapper textarea\.claudian-input\s*\{[\s\S]*?caret-color:\s*var\(--text-normal\);/,
    );
    expect(css).toMatch(
      /\.claudian-input-mention-highlights\s*\{[\s\S]*?color:\s*var\(--text-normal\);/,
    );
  });

  it('keeps the placeholder visible when the textarea text is rendered by the mention layer', () => {
    expect(css).toMatch(
      /\.claudian-input-wrapper textarea\.claudian-input::placeholder\s*\{[\s\S]*?-webkit-text-fill-color:\s*var\(--text-muted\)\s*!important;/,
    );
  });

  it('uses the same composer styling on home and conversation surfaces', () => {
    expect(css).not.toMatch(/\.claudian-home-state \.claudian-input-footer\s*\{/);
    expect(css).not.toMatch(/\.claudian-home-state \.claudian-input-wrapper\s*\{/);
    expect(css).not.toMatch(
      /\.claudian-home-state \.claudian-input-wrapper textarea\.claudian-input\s*\{/,
    );
    expect(css).not.toMatch(/\.claudian-home-state \.claudian-input-mention-highlights\s*\{/);
    expect(css).not.toMatch(
      /\.claudian-home-state \.claudian-input-mention-highlights-content\s*\{/,
    );
    expect(css).not.toMatch(/\.claudian-home-state \.claudian-input-toolbar\s*\{/);
  });

  it('keeps the editor tall enough for text when context rows consume composer space', () => {
    expect(css).toMatch(
      /\.claudian-input-editor\s*\{[^}]*flex:\s*1 1 auto;/,
    );
  });
});
