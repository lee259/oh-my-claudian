/** @jest-environment jsdom */

import { loadMermaid } from 'obsidian';

import { renderMermaidDiagram } from '@/features/chat/rendering/MermaidRenderer';

describe('renderMermaidDiagram', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders through Obsidian Mermaid directly with strict security', async () => {
    const bindFunctions = jest.fn();
    const render = jest.fn().mockResolvedValue({
      svg: '<svg data-diagram="safe"></svg>',
      bindFunctions,
    });
    (loadMermaid as jest.Mock).mockResolvedValueOnce({
      initialize: jest.fn(),
      render,
    });
    const host = document.createElement('div');
    host.innerHTML = '<span>stale</span>';

    await renderMermaidDiagram('flowchart TB\nA --> B', host);

    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^claudian-mermaid-/), 'flowchart TB\nA --> B');
    expect(host.querySelector('svg')?.getAttribute('data-diagram')).toBe('safe');
    expect(bindFunctions).toHaveBeenCalledWith(host);
  });
});
