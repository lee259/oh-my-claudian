export interface CollapsibleState {
  isExpanded: boolean;
}

export interface CollapsibleOptions {
  /** Initial expanded state (default: false) */
  initiallyExpanded?: boolean;
  /** Runs before the transition so deferred content can be rendered and measured. */
  beforeToggle?: (isExpanded: boolean) => void;
  /** Callback when state changes */
  onToggle?: (isExpanded: boolean) => void;
  /** Base label for aria-label (will append "click to expand/collapse") */
  baseAriaLabel?: string;
}

const contentAnimations = new WeakMap<HTMLElement, Animation>();

/** Applies the transcript fold transition to a disclosure content region. */
export function setCollapsibleContentExpanded(
  contentEl: HTMLElement,
  expanded: boolean,
  setHidden: (hidden: boolean) => void,
): void {
  const previousAnimation = contentAnimations.get(contentEl);
  const wasHidden = contentEl.hidden || contentEl.classList.contains('claudian-hidden');
  const currentHeight = wasHidden ? 0 : contentEl.getBoundingClientRect().height;
  previousAnimation?.cancel();
  contentAnimations.delete(contentEl);

  setHidden(false);
  const view = contentEl.ownerDocument?.defaultView;
  const reducedMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reducedMotion || typeof contentEl.animate !== 'function') {
    setHidden(!expanded);
    return;
  }

  const targetHeight = expanded ? contentEl.scrollHeight : 0;
  const animation = contentEl.animate(
    [
      { height: `${currentHeight}px`, opacity: expanded ? 0 : 1 },
      { height: `${targetHeight}px`, opacity: expanded ? 1 : 0 },
    ],
    {
      duration: 280,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  );
  contentAnimations.set(contentEl, animation);
  animation.onfinish = () => {
    if (contentAnimations.get(contentEl) !== animation) return;
    contentAnimations.delete(contentEl);
    setHidden(!expanded);
  };
}

/**
 * Setup collapsible behavior on a header/content pair.
 *
 * Handles:
 * - Click to toggle
 * - Enter/Space keyboard navigation
 * - aria-expanded attribute
 * - CSS 'expanded' class on wrapper
 * - content display style
 *
 * @param wrapperEl - The wrapper element to add/remove 'expanded' class
 * @param headerEl - The clickable header element
 * @param contentEl - The content element to show/hide
 * @param state - State object to track isExpanded (mutated by this function)
 * @param options - Optional configuration
 */
export function setupCollapsible(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState,
  options: CollapsibleOptions = {}
): void {
  const { initiallyExpanded = false, onToggle, baseAriaLabel } = options;

  // Helper to update aria-label based on expanded state
  const updateAriaLabel = (isExpanded: boolean) => {
    if (baseAriaLabel) {
      const action = isExpanded ? 'click to collapse' : 'click to expand';
      headerEl.setAttribute('aria-label', `${baseAriaLabel} - ${action}`);
    }
  };

  // Set initial state
  state.isExpanded = initiallyExpanded;
  if (initiallyExpanded) {
    wrapperEl.addClass('expanded');
    contentEl.removeClass('claudian-hidden');
    headerEl.setAttribute('aria-expanded', 'true');
  } else {
    contentEl.addClass('claudian-hidden');
    headerEl.setAttribute('aria-expanded', 'false');
  }
  updateAriaLabel(initiallyExpanded);

  // Toggle handler
  const toggleExpand = () => {
    const nextExpanded = !state.isExpanded;
    options.beforeToggle?.(nextExpanded);
    state.isExpanded = nextExpanded;
    if (state.isExpanded) {
      wrapperEl.addClass('expanded');
      headerEl.setAttribute('aria-expanded', 'true');
    } else {
      wrapperEl.removeClass('expanded');
      headerEl.setAttribute('aria-expanded', 'false');
    }
    setCollapsibleContentExpanded(contentEl, state.isExpanded, hidden => {
      if (hidden) contentEl.addClass('claudian-hidden');
      else contentEl.removeClass('claudian-hidden');
    });
    updateAriaLabel(state.isExpanded);
    onToggle?.(state.isExpanded);
  };

  // Click handler
  headerEl.addEventListener('click', toggleExpand);

  // Keyboard handler (Enter/Space)
  headerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpand();
    }
  });
}

/**
 * Collapse a collapsible element and sync state.
 * Use this when programmatically collapsing (e.g., on finalize).
 */
export function collapseElement(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState
): void {
  state.isExpanded = false;
  wrapperEl.removeClass('expanded');
  contentEl.addClass('claudian-hidden');
  headerEl.setAttribute('aria-expanded', 'false');
}
