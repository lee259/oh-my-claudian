/** @jest-environment jsdom */

import { axe } from 'jest-axe';

import { type MentionDropdownCallbacks, MentionDropdownController } from '@/shared/mention/MentionDropdownController';

jest.mock('@/utils/externalContextScanner', () => ({
  externalContextScanner: { scanPaths: jest.fn().mockReturnValue([]) },
}));

HTMLElement.prototype.setText ??= function (text: string): void { this.textContent = text; };
HTMLElement.prototype.scrollIntoView ??= jest.fn();

describe('mention picker interactions', () => {
  let container: HTMLElement;
  let input: HTMLTextAreaElement;
  let controller: MentionDropdownController;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.body.createDiv();
    input = container.createEl('textarea', { attr: { 'aria-label': 'Message' } });
    const callbacks: MentionDropdownCallbacks = {
      getMentionedMcpServers: () => new Set(),
      setMentionedMcpServers: () => false,
      addMentionedMcpServer: jest.fn(),
      getExternalContexts: () => [],
      getCachedVaultFolders: () => [],
      getCachedVaultFiles: () => [
        { name: 'plan.md', path: 'projects/one/plan.md', stat: { mtime: 2 } },
        { name: 'plan.md', path: 'projects/two/plan.md', stat: { mtime: 1 } },
      ] as any,
      normalizePathForVault: path => path ?? null,
    };
    controller = new MentionDropdownController(container, input, callbacks);
    input.addEventListener('input', () => controller.handleInputChange());
  });

  afterEach(() => {
    controller.destroy();
    container.remove();
    jest.useRealTimers();
  });

  function type(query: string) {
    input.value = query;
    input.selectionStart = input.selectionEnd = query.length;
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
  }

  it('distinguishes duplicate filenames and inserts the keyboard-selected full path', async () => {
    type('@plan');
    const rows = [...container.querySelectorAll('[role="option"]')];
    expect(rows.map(row => row.querySelector('.claudian-mention-name')?.textContent)).toEqual(['@plan.md', '@plan.md']);
    expect(rows.map(row => row.querySelector('.claudian-mention-desc')?.textContent)).toEqual(['projects/one/', 'projects/two/']);
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[1].id);
    // axe uses timers internally.
    jest.useRealTimers();
    expect((await axe(container)).violations).toEqual([]);
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(input.value).toBe('@projects/two/plan.md ');
    expect(input.hasAttribute('aria-controls')).toBe(false);
  });

  it('suspends suggestions throughout IME composition and resumes on completion', () => {
    type('@plan');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    type('@计划');
    expect(controller.isVisible()).toBe(false);
    input.dispatchEvent(new CompositionEvent('compositionend'));
    jest.advanceTimersByTime(200);
    expect(controller.isVisible()).toBe(true);
    expect(container.querySelector('.claudian-mention-empty')?.textContent).toBeTruthy();
  });

  it('keeps agent browsing searchable after opening the submenu and supports Escape back', () => {
    controller.setAgentService({ searchAgents: query => [
      { id: 'review', name: 'Review', source: 'builtin' as const },
    ].filter(agent => agent.id.includes(query)) });
    type('@agents');
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(input.value).toBe('@Agents/');
    type(`${input.value}rev`);
    expect(container.querySelector('[role="option"]')?.textContent).toContain('@review');
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(input.value).toBe('@');
    expect(controller.isVisible()).toBe(true);
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(controller.isVisible()).toBe(false);
  });

  it('does not reopen from an old mention after starting a new line', () => {
    type('@plan\nnext');
    expect(controller.isVisible()).toBe(false);
  });
});
