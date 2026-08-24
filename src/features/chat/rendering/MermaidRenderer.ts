import { loadMermaid } from 'obsidian';

interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: HTMLElement) => void;
}

interface MermaidRuntime {
  initialize?: (config: { securityLevel: 'strict'; startOnLoad: false }) => void;
  render: (id: string, source: string) => Promise<MermaidRenderResult>;
}

let nextDiagramId = 0;
let mermaidInitialized = false;

/** Renders one Mermaid source through Obsidian's Mermaid runtime, not Markdown processors. */
export async function renderMermaidDiagram(
  source: string,
  host: HTMLElement,
): Promise<void> {
  const runtime = await loadMermaid() as MermaidRuntime;
  if (!mermaidInitialized) {
    runtime.initialize?.({ securityLevel: 'strict', startOnLoad: false });
    mermaidInitialized = true;
  }

  const result = await runtime.render(`claudian-mermaid-${nextDiagramId++}`, source);
  host.replaceChildren();
  const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Mermaid returned invalid SVG markup');
  }
  host.appendChild(host.ownerDocument.importNode(svg, true));
  result.bindFunctions?.(host);
}
