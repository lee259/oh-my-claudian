/** @jest-environment jsdom */

const mockModalInstances: Array<{ close: () => void }> = [];
const mockComponents: Array<{ load: jest.Mock; unload: jest.Mock }> = [];

jest.mock('obsidian', () => ({
  Modal: class MockModal {
    app: unknown;
    contentEl = document.createElement('div');
    modalEl = document.createElement('div');
    constructor(app: unknown) {
      this.app = app;
      Object.assign(this.contentEl, {
        empty: () => { this.contentEl.replaceChildren(); },
        addClass: (className: string) => { this.contentEl.classList.add(className); },
      });
      Object.assign(this.modalEl, {
        addClass: (className: string) => { this.modalEl.classList.add(className); },
      });
      mockModalInstances.push(this);
    }
    close(): void { (this as unknown as { onClose?: () => void }).onClose?.(); }
    open(): void { void (this as unknown as { onOpen?: () => Promise<void> }).onOpen?.(); }
    setTitle(): void {}
  },
  Component: class MockComponent {
    load = jest.fn();
    unload = jest.fn();
    constructor() { mockComponents.push(this); }
  },
  MarkdownRenderer: { render: jest.fn().mockResolvedValue(undefined) },
  Notice: jest.fn(),
  Setting: class MockSetting {},
  setIcon: (element: HTMLElement, icon: string) => {
    element.dataset.icon = icon;
  },
}));

import { MarkdownRenderer } from 'obsidian';

import type { AgentSkillListResult } from '@/core/skills/AgentSkill';
import { AgentSkillSettings } from '@/shared/settings/AgentSkillSettings';

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

function createCoordinator(result: AgentSkillListResult) {
  return {
    list: jest.fn().mockResolvedValue(result),
    subscribe: jest.fn(() => jest.fn()),
    create: jest.fn(),
    update: jest.fn(),
    trash: jest.fn(),
  };
}

describe('AgentSkillSettings Preact view', () => {
  beforeEach(() => {
    mockModalInstances.length = 0;
    mockComponents.length = 0;
    jest.mocked(MarkdownRenderer.render).mockClear();
  });

  it('renders shared skills and diagnostics through its public constructor', async () => {
    const container = document.createElement('div');
    const providerSetting = document.createElement('div');
    providerSetting.textContent = 'Provider setup remains visible';
    container.append(providerSetting);
    const coordinator = createCoordinator({
      skills: [{
        name: 'release-notes',
        description: 'Prepare release notes',
        instructions: 'Summarize changes',
        frontmatter: {},
        directoryPath: '.agents/skills/release-notes',
        filePath: '.agents/skills/release-notes/SKILL.md',
        revision: 'revision-1',
      }],
      diagnostics: [{
        directoryPath: '.agents/skills/invalid',
        message: 'Missing description',
      }],
    });

    new AgentSkillSettings(container, coordinator as never, {} as never);
    await tick();

    expect(container.querySelector('.claudian-sp-item-name')?.textContent).toBe('release-notes');
    expect(container.querySelector('.claudian-sp-item-desc')?.textContent)
      .toBe('Prepare release notes');
    expect(container.querySelector('.claudian-agent-skills-diagnostic')?.textContent)
      .toContain('Missing description');
    expect(container.contains(providerSetting)).toBe(true);
  });

  it('unmounts its view and unsubscribes when disposed', async () => {
    const container = document.createElement('div');
    const unsubscribe = jest.fn();
    const coordinator = createCoordinator({ skills: [], diagnostics: [] });
    coordinator.subscribe.mockReturnValue(unsubscribe);
    const settings = new AgentSkillSettings(container, coordinator as never, {} as never);
    await tick();

    settings.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.claudian-agent-skills-manager')?.childElementCount).toBe(0);
  });

  it('opens a rendered skill preview and unloads its markdown component when closed', async () => {
    const container = document.createElement('div');
    const skill = {
      name: 'release-notes',
      description: 'Prepare release notes',
      instructions: 'Summarize changes',
      frontmatter: {},
      directoryPath: '.agents/skills/release-notes',
      filePath: '.agents/skills/release-notes/SKILL.md',
      revision: 'revision-1',
    };
    const settings = new AgentSkillSettings(
      container,
      createCoordinator({ skills: [skill], diagnostics: [] }) as never,
      {} as never,
    );
    await tick();

    (container.querySelector('.claudian-agent-skill-item-link') as HTMLButtonElement).click();
    await tick();

    expect(MarkdownRenderer.render).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Summarize changes'),
      expect.any(HTMLElement),
      '.agents/skills/release-notes/SKILL.md',
      mockComponents[0],
    );
    expect(mockComponents[0]?.load).toHaveBeenCalledTimes(1);

    mockModalInstances.at(-1)?.close();
    expect(mockComponents[0]?.unload).toHaveBeenCalledTimes(1);
    settings.dispose();
  });
});
