/** @jest-environment jsdom */

import { h, render } from 'preact';

import { EnvSnippetListView } from '@/shared/settings/EnvSnippetListView';

describe('EnvSnippetListView', () => {
  const labels = {
    name: 'Snippets',
    add: 'Add snippet',
    empty: 'No saved snippets',
    insert: 'Insert',
    edit: 'Edit',
    delete: 'Delete',
  };

  it('renders the empty state and an accessible add action', () => {
    const onAdd = jest.fn();
    const container = document.createElement('div');

    render(h(EnvSnippetListView, {
      items: [],
      labels,
      onAdd,
      onInsert: jest.fn(),
      onEdit: jest.fn(),
      onDelete: jest.fn(),
    }), container);

    expect(container.querySelector('.claudian-snippet-label')?.textContent).toBe('Snippets');
    expect(container.querySelector('.claudian-snippet-empty')?.textContent).toBe('No saved snippets');

    const addButton = container.querySelector<HTMLButtonElement>('button[aria-label="Add snippet"]');
    expect(addButton?.type).toBe('button');
    addButton?.click();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders snippet actions and routes each action by snippet id', () => {
    const onInsert = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const container = document.createElement('div');

    render(h(EnvSnippetListView, {
      items: [
        { id: 'staging', name: 'Staging', description: 'Shared staging variables' },
        { id: 'production', name: 'Production', description: '' },
      ],
      labels,
      onAdd: jest.fn(),
      onInsert,
      onEdit,
      onDelete,
    }), container);

    const items = [...container.querySelectorAll('.claudian-snippet-item')];
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.claudian-snippet-name')?.textContent).toBe('Staging');
    expect(items[0]?.querySelector('.claudian-snippet-description')?.textContent)
      .toBe('Shared staging variables');
    expect(items[1]?.querySelector('.claudian-snippet-description')).toBeNull();

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.every(button => button.type === 'button')).toBe(true);
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      'Add snippet',
      'Insert: Staging',
      'Edit: Staging',
      'Delete: Staging',
      'Insert: Production',
      'Edit: Production',
      'Delete: Production',
    ]);

    buttons[1]?.click();
    buttons[5]?.click();
    buttons[6]?.click();
    expect(onInsert).toHaveBeenCalledWith('staging');
    expect(onEdit).toHaveBeenCalledWith('production');
    expect(onDelete).toHaveBeenCalledWith('production');
  });
});
