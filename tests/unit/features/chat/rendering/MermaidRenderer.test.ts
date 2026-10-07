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

  it('repairs HTML-serialized labels before parsing SVG as XML', async () => {
    (loadMermaid as jest.Mock).mockResolvedValueOnce({
      render: jest.fn().mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'
          + '<foreignObject width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml">'
          + '<p>First line<br>Second&nbsp;line</p></div></foreignObject></svg>',
      }),
    });
    const host = document.createElement('div');

    await renderMermaidDiagram('flowchart LR\nA --> B', host);

    const label = host.querySelector('foreignObject p');
    expect(label?.getElementsByTagName('br')).toHaveLength(1);
    expect(label?.textContent).toBe('First lineSecond\u00a0line');
  });

  it('keeps well-formed SVG unchanged instead of reparsing it as HTML', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g><text>a<br/>b</text><rect/></g></svg>';
    (loadMermaid as jest.Mock).mockResolvedValueOnce({
      render: jest.fn().mockResolvedValue({ svg }),
    });
    const host = document.createElement('div');

    await renderMermaidDiagram('flowchart LR\nA --> B', host);

    const diagram = host.querySelector('svg');
    expect(diagram?.querySelector('text')?.children).toHaveLength(1);
    expect(diagram?.querySelector('rect')).not.toBeNull();
  });
});
