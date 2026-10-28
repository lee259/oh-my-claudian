const imageDrops = new WeakSet<DragEvent>();

/** Keeps image drops from also becoming file context while allowing overlay cleanup. */
export function markImageDrop(event: DragEvent): void {
  imageDrops.add(event);
}

export function isImageDrop(event: DragEvent): boolean {
  return imageDrops.has(event);
}
