/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  Modal: class MockModal {
    contentEl = document.createElement('div');
    modalEl = document.createElement('div');
    constructor(_app: unknown) {}
    close(): void {}
    open(): void {}
    setTitle(): void {}
  },
  Notice: jest.fn(),
  Setting: class MockSetting {},
  setIcon: (element: HTMLElement, icon: string) => {
    element.dataset.icon = icon;
  },
}));

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
});
