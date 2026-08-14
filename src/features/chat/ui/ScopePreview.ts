import { setIcon } from 'obsidian';

export interface ScopePreviewModel {
  label: string;
  detail: string;
  title: string;
}

function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop() || path;
}

export function buildScopePreviewModel(
  currentNotePath: string | null,
  externalContextPaths: readonly string[],
): ScopePreviewModel | null {
  const note = currentNotePath ? getPathName(currentNotePath) : null;
  const folders = externalContextPaths.map(getPathName);
  if (!note && folders.length === 0) return null;

  const parts = [
    ...(note ? [`note: ${note}`] : []),
    ...(folders.length > 0
      ? [`folder${folders.length === 1 ? '' : 's'}: ${folders.join(', ')}`]
      : []),
  ];
  return {
    label: 'Context scope',
    detail: parts.join(' · '),
    title: `${parts.join(' · ')}. Writes remain governed by the selected provider's permissions.`,
  };
}

/** Presents the context boundary without owning context selection or execution. */
export class ScopePreview {
  private readonly containerEl: HTMLElement;
  private currentNotePath: string | null = null;
  private externalContextPaths: string[] = [];

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.containerEl.addClass('claudian-scope-preview');
    this.render();
  }

  setCurrentNote(path: string | null): void {
    this.currentNotePath = path;
    this.render();
  }

  setExternalContextPaths(paths: readonly string[]): void {
    this.externalContextPaths = [...paths];
    this.render();
  }

  clear(): void {
    this.currentNotePath = null;
    this.externalContextPaths = [];
    this.render();
  }

  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-scope-preview');
  }

  private render(): void {
    this.containerEl.empty();
    const model = buildScopePreviewModel(this.currentNotePath, this.externalContextPaths);
    this.containerEl.toggleClass('has-content', model !== null);
    if (!model) return;

    const iconEl = this.containerEl.createSpan({ cls: 'claudian-scope-preview-icon' });
    setIcon(iconEl, 'layers-3');
    this.containerEl.createSpan({
      cls: 'claudian-scope-preview-label',
      text: `${model.label}:`,
    });
    const detailEl = this.containerEl.createSpan({
      cls: 'claudian-scope-preview-detail',
      text: model.detail,
    });
    detailEl.setAttribute('title', model.title);
    this.containerEl.setAttribute('aria-label', model.title);
  }
}
