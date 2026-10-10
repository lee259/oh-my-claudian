/** Whether a nested region can consume this input before it reaches its parent. */
export function isNestedScrollEvent(event: Event, container: HTMLElement): boolean {
  const selectors = '.claudian-thinking-content, .claudian-streaming-work-history';
  let region = (event.target as Element | null)?.closest?.<HTMLElement>(selectors);
  while (region && region !== container) {
    const deltaY = event.type === 'wheel' ? (event as WheelEvent).deltaY : 0;
    const canConsume = !deltaY || (deltaY < 0
      ? region.scrollTop > 0
      : region.scrollTop + region.clientHeight < region.scrollHeight);
    if (region.scrollHeight > region.clientHeight && canConsume) return true;
    region = region.parentElement?.closest?.<HTMLElement>(selectors);
  }
  return false;
}

/** Tracks user intent independently of content growth in a bounded viewport. */
export class ScrollFollowController {
  scrollTop: number;
  following: boolean;
  version = 0;
  private readonly intentEvents = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;

  constructor(
    readonly element: HTMLElement,
    previous?: { scrollTop: number; following: boolean },
  ) {
    this.scrollTop = previous?.scrollTop ?? element.scrollTop;
    this.following = previous?.following
      ?? (element.scrollHeight - element.scrollTop - element.clientHeight <= 20);
    element.addEventListener('scroll', this.handleScroll, { passive: true });
    for (const event of this.intentEvents) {
      element.addEventListener(event, this.handleIntent, { passive: true });
    }
  }

  private readonly handleScroll = (): void => { this.capture(); };

  private readonly handleIntent = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (isNestedScrollEvent(event, this.element)) return;
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key.toLowerCase();
      if (!['arrowup', 'arrowdown', 'pageup', 'pagedown', 'home', 'end', ' '].includes(key)) return;
      if (target?.matches?.('input, textarea, select, button, a, [role="button"]') || target?.isContentEditable) return;
    }
    this.scrollTop = this.element.scrollTop;
    this.following = false;
    this.version++;
  };

  capture(): void {
    const { scrollTop, scrollHeight, clientHeight } = this.element;
    if (scrollTop === this.scrollTop) return;
    const atBottom = scrollHeight - scrollTop - clientHeight <= 20;
    // A paused reader must actually move down to resume. A stale scroll event
    // or a small upward move near the bottom cannot revoke their intent.
    if (this.following || (scrollTop > this.scrollTop && atBottom)) this.following = atBottom;
    this.scrollTop = scrollTop;
  }

  resume(): void {
    this.following = true;
    this.version++;
  }

  restore(enabled: boolean): void {
    this.element.scrollTop = enabled && this.following ? this.element.scrollHeight : this.scrollTop;
    this.scrollTop = this.element.scrollTop;
  }

  dispose(): void {
    this.element.removeEventListener('scroll', this.handleScroll);
    for (const event of this.intentEvents) this.element.removeEventListener(event, this.handleIntent);
  }
}
