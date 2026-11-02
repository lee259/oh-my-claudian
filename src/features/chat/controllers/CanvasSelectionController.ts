import type { App, EventRef, ItemView } from 'obsidian';

import type { CanvasSelectionContext } from '../../../utils/canvas';
import type { ComposerContextTray } from '../ui/ComposerContextTray';
import { VisibilityGatedPoller } from './VisibilityGatedPoller';

const CANVAS_POLL_INTERVAL = 250;

type CanvasSelectionNode = { id?: unknown };

type CanvasViewLike = ItemView & {
  canvas?: {
    selection?: Set<CanvasSelectionNode>;
  };
  file?: {
    path?: unknown;
  };
};

export class CanvasSelectionController {
  private app: App;
  private contextTray: ComposerContextTray;
  private inputEl: HTMLElement;
  private onVisibilityChange: (() => void) | null;
  private onUserSelectionChanged: (() => void) | null;
  private storedSelection: CanvasSelectionContext | null = null;
  private sourceView: CanvasViewLike | null = null;
  private readonly poller: VisibilityGatedPoller;
  private started = false;
  private workspaceEventRefs: EventRef[] = [];

  constructor(
    app: App,
    contextTray: ComposerContextTray,
    inputEl: HTMLElement,
    onVisibilityChange?: () => void,
    onUserSelectionChanged?: () => void,
  ) {
    this.app = app;
    this.contextTray = contextTray;
    this.inputEl = inputEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
    this.onUserSelectionChanged = onUserSelectionChanged ?? null;
    this.poller = new VisibilityGatedPoller({
      ownerDocument: inputEl.ownerDocument,
      ownerWindow: inputEl.ownerDocument.defaultView ?? window,
      intervalMs: CANVAS_POLL_INTERVAL,
      poll: () => this.poll(),
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.registerWorkspaceEvents();
    this.syncActiveCanvasPolling();
  }

  stop(): void {
    this.started = false;
    this.releaseWorkspaceEvents();
    this.poller.stop();
    this.clear();
  }

  private registerWorkspaceEvents(): void {
    if (this.workspaceEventRefs.length > 0) return;
    const workspace = this.app.workspace as typeof this.app.workspace & {
      on?: (event: 'active-leaf-change' | 'layout-change', callback: () => void) => EventRef;
    };
    if (!workspace.on) return;
    this.workspaceEventRefs = [
      workspace.on('active-leaf-change', () => this.syncActiveCanvasPolling()),
      workspace.on('layout-change', () => this.syncActiveCanvasPolling()),
    ];
  }

  private releaseWorkspaceEvents(): void {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      offref?: (ref: EventRef) => void;
    };
    if (workspace.offref) {
      for (const ref of this.workspaceEventRefs) workspace.offref(ref);
    }
    this.workspaceEventRefs = [];
  }

  private syncActiveCanvasPolling(): void {
    if (!this.started) return;
    if (this.getCanvasView()) {
      this.poller.start();
      return;
    }
    this.poller.stop();
    this.clearWhenCanvasIsUnavailable();
  }

  private poll(): void {
    const canvasView = this.getCanvasView();
    if (!canvasView) {
      this.clearWhenCanvasIsUnavailable();
      return;
    }

    const canvas = canvasView.canvas;
    if (!canvas?.selection) return;

    const selection = canvas.selection;
    const canvasPath = canvasView.file?.path;
    if (typeof canvasPath !== 'string' || !canvasPath) return;

    const nodeIds = [...selection]
      .map(node => node.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (nodeIds.length > 0) {
      const sameSelection = this.sourceView === canvasView && this.storedSelection
        && this.storedSelection.canvasPath === canvasPath
        && this.storedSelection.nodeIds.length === nodeIds.length
        && this.storedSelection.nodeIds.every(id => nodeIds.includes(id));

      if (!sameSelection) {
        this.sourceView = canvasView;
        this.storedSelection = { canvasPath, nodeIds };
        this.updateIndicator();
        this.onUserSelectionChanged?.();
      }
    } else if (!this.inputEl.contains(this.getActiveElement())
      || this.sourceView !== canvasView || this.storedSelection?.canvasPath !== canvasPath) {
      this.clearSelection();
    }
  }

  private getActiveElement(): Element | null {
    return this.inputEl.ownerDocument?.activeElement ?? null;
  }

  private clearWhenCanvasIsUnavailable(): void {
    const activeView = this.app.workspace.getMostRecentLeaf?.()?.view;
    const activeElement = this.getActiveElement();
    const ownInputHandoff = !!activeElement && this.inputEl.contains(activeElement)
      && activeView?.containerEl?.contains(this.inputEl)
      && this.sourceView?.file?.path === this.storedSelection?.canvasPath
      && this.app.workspace.getLeavesOfType('canvas').some(leaf => leaf.view === this.sourceView);
    if (!ownInputHandoff) this.clearSelection();
  }

  private getCanvasView(): CanvasViewLike | null {
    const activeLeaf = this.app.workspace.getMostRecentLeaf?.();
    const activeView = activeLeaf?.view as CanvasViewLike | undefined;
    if (activeView?.getViewType?.() === 'canvas' && activeView.file) {
      return activeView;
    }

    return null;
  }

  private updateIndicator(): void {
    if (this.storedSelection) {
      const { nodeIds } = this.storedSelection;
      const nodeLabel = nodeIds.length === 1 ? '1 node' : `${nodeIds.length} nodes`;
      const label = `${nodeLabel} selected`;
      this.contextTray.setItems('canvas-selection', [{
        id: 'canvas-selection',
        kind: 'selection',
        label,
        icon: 'network',
        ariaLabel: label,
        onRemove: () => {
          this.clear();
          this.onUserSelectionChanged?.();
        },
      }]);
    } else {
      this.contextTray.clearItems('canvas-selection');
    }
    this.updateContextRowVisibility();
  }

  updateContextRowVisibility(): void {
    this.onVisibilityChange?.();
  }

  getContext(): CanvasSelectionContext | null {
    if (!this.storedSelection) return null;
    return {
      canvasPath: this.storedSelection.canvasPath,
      nodeIds: [...this.storedSelection.nodeIds],
    };
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  private clearSelection(): void {
    if (!this.storedSelection) return;
    this.clear();
    this.onUserSelectionChanged?.();
  }

  clear(): void {
    this.sourceView = null;
    this.storedSelection = null;
    this.updateIndicator();
  }
}
