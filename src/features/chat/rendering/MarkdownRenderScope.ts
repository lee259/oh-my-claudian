import { Component } from 'obsidian';

/** Owns the Obsidian resources registered while rendering one Markdown block. */
export class MarkdownRenderScope extends Component {
  isReleased = false;

  override unload(): void {
    if (this.isReleased) return;
    this.isReleased = true;
    super.unload();
  }

  override register(callback: () => void): void {
    if (this.isReleased) callback();
    else super.register(callback);
  }

  override addChild<T extends Component>(child: T): T {
    if (!this.isReleased) return super.addChild(child);
    // A late embed can acquire resources during load; force its unload path.
    try {
      child.load();
    } finally {
      child.unload();
    }
    return child;
  }
}
