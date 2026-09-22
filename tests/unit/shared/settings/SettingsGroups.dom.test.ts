/** @jest-environment jsdom */

import { frameSettingsGroups } from '@/shared/settings/SettingsGroups';

function createDiv(this: HTMLElement, options?: { cls?: string }): HTMLDivElement {
  const child = this.ownerDocument.createElement('div');
  if (options?.cls) {
    child.className = options.cls;
  }
  this.appendChild(child);
  return child;
}

beforeAll(() => {
  HTMLElement.prototype.createDiv = createDiv;
});

describe('settings group presentation', () => {
  it('frames existing heading ranges without changing controls or their order', () => {
    const page = document.createElement('div');
    page.innerHTML = '<div>Language</div><div class="setting-item-heading">Display</div><button type="button">Toggle display</button><div>Placement</div><div class="setting-item-heading">Input</div><input aria-label="Send shortcut">';
    let clicked = false;
    const button = page.querySelector<HTMLButtonElement>('button');
    if (!button) {
      throw new Error('Expected display control');
    }
    button.addEventListener('click', () => {
      clicked = true;
    });

    frameSettingsGroups(page);

    const groups = Array.from(page.querySelectorAll<HTMLElement>('[role="group"]'));
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Display', 'Input']);
    expect(groups[0].textContent).toBe('DisplayToggle displayPlacement');
    expect(groups[1].querySelector('input[aria-label="Send shortcut"]')).toBeTruthy();
    expect(page.firstElementChild?.textContent).toBe('Language');
    groups[0].querySelector<HTMLButtonElement>('button')?.click();
    expect(clicked).toBe(true);

    frameSettingsGroups(page);

    expect(page.querySelectorAll('[role="group"]')).toHaveLength(2);
  });

  it('leaves an unheaded page in its existing layout', () => {
    const page = document.createElement('div');
    page.innerHTML = '<div>Enable collaboration</div><div>Projects folder</div>';

    frameSettingsGroups(page);

    expect(page.textContent).toBe('Enable collaborationProjects folder');
    expect(page.querySelector('[role="group"]')).toBeNull();
  });
});
