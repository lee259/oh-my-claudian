/** @jest-environment jsdom */

import { h, render } from 'preact';

import { ProviderCapabilityMatrixView } from '@/shared/settings/ProviderCapabilityMatrixView';

describe('ProviderCapabilityMatrixView', () => {
  it('renders an accessible capability table from provider view models', () => {
    const container = document.createElement('div');

    render(h(ProviderCapabilityMatrixView, {
      providerLabel: 'Provider',
      supportedLabel: 'Supported',
      unsupportedLabel: 'Not supported',
      rows: [
        { key: 'planMode', label: 'Plan mode' },
        { key: 'mcpTools', label: 'MCP tools' },
      ],
      providers: [
        {
          label: 'Claude',
          supportedKeys: ['planMode'],
        },
      ],
    }), container);

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect([...container.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual([
      'Provider',
      'Plan mode',
      'MCP tools',
    ]);
    expect(container.querySelector('thead th')?.getAttribute('scope')).toBe('col');
    expect(container.querySelector('tbody th')?.textContent).toBe('Claude');
    expect(container.querySelector('tbody th')?.getAttribute('scope')).toBe('row');
    expect([...container.querySelectorAll('tbody td')].map(cell => cell.textContent)).toEqual([
      'Supported',
      'Not supported',
    ]);
    expect(container.querySelector('td.claudian-capability-supported')).not.toBeNull();
    expect(container.querySelector('td.claudian-capability-unsupported')).not.toBeNull();
  });
});
