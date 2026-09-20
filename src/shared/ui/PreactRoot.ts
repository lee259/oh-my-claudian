import { type ComponentChildren, render } from 'preact';

export interface PreactRoot {
  render(children: ComponentChildren): void;
  unmount(): void;
}

/**
 * Mounts a Preact subtree without exposing Preact lifecycle details to its host.
 * The host owns the container and must call unmount before removing it.
 */
export function createPreactRoot(container: HTMLElement): PreactRoot {
  return {
    render(children) {
      // Some provider/runtime tests use lightweight DOM shims without a global
      // browser document. The real Obsidian host always has one, so keep those
      // tests focused on the surrounding controller lifecycle.
      if (typeof document === 'undefined') return;
      render(children, container);
    },
    unmount() {
      if (typeof document === 'undefined') return;
      render(null, container);
    },
  };
}
