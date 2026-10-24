import type { App, Command, EventRef, Scope, WorkspaceLeaf } from 'obsidian';
import { Platform } from 'obsidian';

import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import { t } from '@/i18n/i18n';

import { ZenModePanel } from './ZenModePanel';

export interface ZenPreview {
  text: string;
  hasMessages: boolean;
  working: boolean;
  requiresAction: boolean;
}

export interface ZenModeSource {
  readonly leaf: WorkspaceLeaf;
  readonly surface: HTMLElement;
  readonly scope?: Scope | null;
  focusInput(): void;
  getPreview(): ZenPreview;
}

export interface ZenPosition { x: number; y: number }

export interface ZenModeControllerOptions {
  app: App;
  isEnabled(): boolean;
  getPosition(): ZenPosition | null;
  savePosition(position: ZenPosition | null): void;
}

/** Owns workspace presentation placement, never conversation or provider lifetime. */
export class ZenModeController {
  private sources = new Set<ZenModeSource>();
  private refs: EventRef[] = [];
  private active: { source: ZenModeSource; marker: Comment; panel: ZenModePanel } | null = null;
  private started = false;
  private disposed = false;
  private preferredSource: ZenModeSource | null = null;
  private loadRequested = new WeakSet<WorkspaceLeaf>();
  private hidden: { source: ZenModeSource; root: ReturnType<WorkspaceLeaf['getRoot']> } | null = null;
  private historyExpanded = new WeakMap<ZenModeSource, boolean>();

  constructor(private readonly options: ZenModeControllerOptions) {}

  createCommands(): Command[] {
    return [{
      id: 'toggle-zen-mode',
      name: t('chat.zen.toggleVisibility'),
      checkCallback: checking => {
        if (this.disposed || !this.options.isEnabled() || (!this.active && !this.hidden)) return false;
        if (checking) return true;
        if (this.active) {
          this.hidden = { source: this.active.source, root: this.active.source.leaf.getRoot() };
          this.refresh();
        } else {
          this.restoreHidden();
        }
        return true;
      },
    }, {
      id: 'toggle-zen-mode-history',
      name: t('chat.zen.toggleHistory'),
      checkCallback: checking => {
        const panel = this.active?.panel;
        const activity = this.active?.source.getPreview();
        if (!panel || !activity?.hasMessages || activity.requiresAction) return false;
        return checking || panel.toggleHistory();
      },
    }];
  }

  private restoreHidden(): void {
    const source = this.hidden?.source;
    if (!source) return;
    this.hidden = null;
    this.preferredSource = source;
    this.refresh();
    if (this.active?.source === source) source.focusInput();
  }

  start(): void {
    this.options.app.workspace.onLayoutReady(() => {
      if (this.disposed || this.started) return;
      this.started = true;
      const workspace = this.options.app.workspace;
      this.refs.push(workspace.on('layout-change', () => this.refresh()),
        workspace.on('resize', () => this.refresh()),
        workspace.on('active-leaf-change', leaf => {
          this.preferredSource = [...this.sources].find(source => source.leaf === leaf) ?? this.preferredSource;
          this.refresh();
        }));
      this.refresh();
    });
  }

  register(source: ZenModeSource): () => void {
    if (this.disposed) return () => undefined;
    this.sources.add(source);
    this.refresh();
    return () => {
      this.sources.delete(source);
      if (this.hidden?.source === source) this.hidden = null;
      if (this.preferredSource === source) this.preferredSource = null;
      if (this.active?.source === source) this.detach();
      this.refresh();
    };
  }

  refresh(): void {
    if (this.disposed) return;
    if (this.hidden && (!this.options.isEnabled() || !this.sources.has(this.hidden.source)
      || this.hidden.source.leaf.getRoot() !== this.hidden.root
      || (this.hidden.root as { collapsed?: boolean }).collapsed !== true)) this.hidden = null;
    const { workspace } = this.options.app;
    const host = (workspace as { containerEl?: HTMLElement }).containerEl
      ?.querySelector<HTMLElement>(':scope > .workspace-split.mod-root');
    const eligible = (source: ZenModeSource) => {
      const root = source.leaf.getRoot();
      return source.surface.ownerDocument === host?.ownerDocument && (root === workspace.leftSplit || root === workspace.rightSplit)
        && (root as { collapsed?: boolean }).collapsed === true;
    };
    const target = !this.hidden && this.started && !Platform.isMobile && host && this.options.isEnabled()
      ? (this.preferredSource && this.sources.has(this.preferredSource) && eligible(this.preferredSource)
        ? this.preferredSource
        : this.active && eligible(this.active.source) ? this.active.source : [...this.sources].find(eligible))
      : undefined;
    if (!target && !this.hidden && this.started && !Platform.isMobile && host && this.options.isEnabled()) {
      const leaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).find(leaf => {
        const root = leaf.getRoot();
        return leaf.isDeferred && !this.loadRequested.has(leaf)
          && (root === workspace.leftSplit || root === workspace.rightSplit)
          && (root as { collapsed?: boolean }).collapsed === true;
      });
      if (leaf) {
        this.loadRequested.add(leaf);
        void leaf.loadIfDeferred().catch(() => undefined);
      }
    }
    if (target === this.active?.source && this.active?.panel.root.parentElement === host) { this.active?.panel.refresh(); return; }
    this.detach();
    if (!target || !host) return;
    const marker = target.surface.ownerDocument.createComment('Zen presentation origin');
    target.surface.before(marker);
    const panel = new ZenModePanel(host, target, this.options, {
      expanded: this.historyExpanded.get(target) ?? false,
      onChange: expanded => this.historyExpanded.set(target, expanded),
    });
    this.active = { source: target, marker, panel };
  }

  private detach(): void {
    if (!this.active) return;
    const { marker, panel } = this.active;
    panel.destroy(marker);
    this.active = null;
  }

  dispose(): void {
    this.disposed = true;
    this.hidden = null;
    this.detach();
    for (const ref of this.refs) this.options.app.workspace.offref(ref);
    this.refs = [];
    this.sources.clear();
  }
}
