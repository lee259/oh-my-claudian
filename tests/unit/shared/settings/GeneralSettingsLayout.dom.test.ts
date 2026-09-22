/** @jest-environment jsdom */

import { h, render } from 'preact';

import {
  GeneralSettingsLayout,
  type GeneralSettingsSection,
} from '@/shared/settings/GeneralSettingsLayout';

const sections: readonly GeneralSettingsSection[] = [
  { id: 'display', title: 'Display', description: 'Tune the chat surface.' },
  { id: 'input', title: 'Input' },
];

describe('GeneralSettingsLayout', () => {
  it('renders ordered accessible sections and exposes their content slots', () => {
    const container = document.createElement('div');
    const mountedSlots = new Map<string, HTMLElement>();

    render(h(GeneralSettingsLayout, {
      sections,
      onSectionMount: (id, element) => {
        if (element) {
          mountedSlots.set(id, element);
        } else {
          mountedSlots.delete(id);
        }
      },
    }), container);

    const renderedSections = [...container.querySelectorAll<HTMLElement>('section')];
    expect(renderedSections).toHaveLength(2);
    expect(renderedSections.map(section => section.dataset.sectionId)).toEqual(['display', 'input']);
    expect(renderedSections.map(section => section.querySelector('h2')?.textContent)).toEqual([
      'Display',
      'Input',
    ]);
    expect(renderedSections.every(section => {
      const heading = section.querySelector('h2');
      return heading && section.getAttribute('aria-labelledby') === heading.id;
    })).toBe(true);
    expect(renderedSections[0].getAttribute('aria-describedby')).toBe(
      'claudian-settings-general-section-display-heading-description',
    );
    expect(renderedSections[0].querySelector('p')?.textContent).toBe('Tune the chat surface.');
    expect([...mountedSlots.keys()]).toEqual(['display', 'input']);
    expect(mountedSlots.get('display')?.className).toBe('claudian-settings-general-section-body');
  });

  it('releases section slots before the layout is removed', () => {
    const container = document.createElement('div');
    const mountEvents: Array<[string, boolean]> = [];

    render(h(GeneralSettingsLayout, {
      sections: [sections[0]],
      onSectionMount: (id, element) => mountEvents.push([id, element !== null]),
    }), container);
    render(null, container);

    expect(mountEvents).toEqual([
      ['display', true],
      ['display', false],
    ]);
  });
});
