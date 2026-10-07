import { loadMermaid } from 'obsidian';

interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: HTMLElement) => void;
}

interface MermaidRuntime {
  initialize?: (config: { securityLevel: 'strict'; startOnLoad: false }) => void;
  render: (id: string, source: string) => Promise<MermaidRenderResult>;
}

function toXmlSvg(svg: string): string | null {
  const root = new DOMParser().parseFromString(svg, 'text/html').body.firstElementChild;
  if (root?.localName !== 'svg') return null;

  // HTML parsing keeps SVG/XHTML xmlns declarations as plain attributes. Let XMLSerializer
  // derive them from the elements' namespaces to avoid duplicate declarations.
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    element.removeAttribute('xmlns');
  }
  return new XMLSerializer().serializeToString(root);
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
  const initial = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  // Mermaid serializes HTML labels with HTML rules (for example, `<br>` and `&nbsp;`).
  // Keep valid SVG byte-for-byte; only use an inert HTML parse when XML rejects the output.
  const markup = initial.querySelector('parsererror') ? toXmlSvg(result.svg) : result.svg;
  if (!markup) {
    throw new Error('Mermaid returned invalid SVG markup');
  }
  const parsed = markup === result.svg
    ? initial
    : new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) {
    throw new Error('Mermaid returned invalid SVG markup');
  }
  host.appendChild(host.ownerDocument.importNode(svg, true));
  result.bindFunctions?.(host);
}
