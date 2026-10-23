import type { ZenPosition } from './ZenModeController';

/** Presentation-only drag/keyboard placement, stored relative to the workspace size. */
export class ZenPanelDock {
  private position: ZenPosition | null;
  private observer: ResizeObserver | null = null;
  private drag: { id: number; x: number; y: number; left: number; top: number; before: ZenPosition | null } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly root: HTMLElement,
    private readonly grip: HTMLButtonElement,
    position: ZenPosition | null,
    private readonly save: (position: ZenPosition | null) => void,
  ) {
    this.position = position;
    grip.addEventListener('pointerdown', this.onPointerDown);
    grip.addEventListener('keydown', this.onKeyDown);
    grip.addEventListener('dblclick', this.onHome);
    const Resize = host.ownerDocument.defaultView?.ResizeObserver;
    if (Resize) {
      this.observer = new Resize(() => this.refresh());
      this.observer.observe(host);
      this.observer.observe(root);
    }
    host.ownerDocument.defaultView?.addEventListener('resize', this.onResize);
    this.refresh();
  }

  private geometry() {
    const host = this.host.getBoundingClientRect();
    const panel = this.root.getBoundingClientRect();
    return {
      width: host.width, height: host.height,
      homeX: Math.max(8, (host.width - panel.width) / 2),
      homeY: Math.max(8, host.height - panel.height - 40),
      maxX: Math.max(8, host.width - panel.width - 8),
      maxY: Math.max(8, host.height - panel.height - 8),
    };
  }

  refresh(): void {
    const g = this.geometry();
    const left = Math.max(8, Math.min(g.maxX, g.homeX + (this.position?.x ?? 0) * g.width));
    const top = Math.max(8, Math.min(g.maxY, g.homeY + (this.position?.y ?? 0) * g.height));
    Object.assign(this.root.style, { left: `${left}px`, top: `${top}px`, bottom: 'auto', transform: 'none' });
  }

  private move(left: number, top: number, persist: boolean): void {
    const g = this.geometry();
    left = Math.max(8, Math.min(g.maxX, left));
    top = Math.max(8, Math.min(g.maxY, top));
    const nearHome = Math.hypot(left - g.homeX, top - g.homeY) <= 32;
    this.root.classList.toggle('is-dock-target', nearHome && !!this.drag);
    this.position = nearHome && persist ? null : {
      x: g.width ? (left - g.homeX) / g.width : 0,
      y: g.height ? (top - g.homeY) / g.height : 0,
    };
    this.refresh();
    if (persist) this.save(this.position);
  }

  private onResize = (): void => this.refresh();
  private onHome = (): void => {
    this.position = null;
    this.refresh();
    this.save(null);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'Home') { event.preventDefault(); this.onHome(); return; }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 16;
    this.move(parseFloat(this.root.style.left) + delta[0] * step, parseFloat(this.root.style.top) + delta[1] * step, false);
    this.save(this.position);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag) return;
    event.preventDefault();
    this.grip.focus();
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: parseFloat(this.root.style.left), top: parseFloat(this.root.style.top), before: this.position };
    this.root.classList.add('is-dragging');
    this.grip.setPointerCapture?.(event.pointerId);
    const doc = this.root.ownerDocument;
    doc.addEventListener('pointermove', this.onPointerMove);
    doc.addEventListener('pointerup', this.onPointerUp);
    doc.addEventListener('pointercancel', this.onPointerCancel);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    this.move(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y, false);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.onPointerMove(event);
    this.move(parseFloat(this.root.style.left), parseFloat(this.root.style.top), true);
    this.endDrag();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.position = this.drag.before;
    this.endDrag();
    this.refresh();
  };

  private endDrag(): void {
    if (this.drag && this.grip.hasPointerCapture?.(this.drag.id)) this.grip.releasePointerCapture(this.drag.id);
    this.drag = null;
    this.root.classList.remove('is-dragging', 'is-dock-target');
    const doc = this.root.ownerDocument;
    doc.removeEventListener('pointermove', this.onPointerMove);
    doc.removeEventListener('pointerup', this.onPointerUp);
    doc.removeEventListener('pointercancel', this.onPointerCancel);
  }

  destroy(): void {
    this.endDrag();
    this.observer?.disconnect();
    this.host.ownerDocument.defaultView?.removeEventListener('resize', this.onResize);
    this.grip.removeEventListener('pointerdown', this.onPointerDown);
    this.grip.removeEventListener('keydown', this.onKeyDown);
    this.grip.removeEventListener('dblclick', this.onHome);
  }
}
