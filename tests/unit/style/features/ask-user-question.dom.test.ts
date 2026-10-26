/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Question option wrapping in the Obsidian host', () => {
  it('overrides host button nowrap without changing unrelated buttons', () => {
    const style = document.createElement('style');
    style.textContent = 'button { white-space: nowrap; }\n' + readFileSync(
      path.resolve('src/style/features/ask-user-question.css'), 'utf8',
    );
    document.head.append(style);
    const row = document.body.appendChild(document.createElement('button'));
    row.className = 'claudian-ask-item';
    row.textContent = 'A long option label with a description that must wrap inside the chat.';
    const hostButton = document.body.appendChild(document.createElement('button'));
    try {
      expect(getComputedStyle(row).whiteSpace).toBe('normal');
      expect(getComputedStyle(hostButton).whiteSpace).toBe('nowrap');
    } finally {
      row.remove(); hostButton.remove(); style.remove();
    }
  });
});
