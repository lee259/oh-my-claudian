import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Approval detail styles', () => {
  it('keeps long approval descriptions scrollable within the chat', () => {
    const css = readFileSync(
      path.resolve('src/style/features/ask-user-question.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.claudian-ask-approval-desc\s*{[^}]*max-height:\s*min\(30vh, 240px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/,
    );
    expect(css).toMatch(/\.claudian-ask-approval-desc:focus-visible\s*{/);
  });
});
