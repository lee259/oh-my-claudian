import type { TabData } from './types';

export type TabActivationResult =
  | { status: 'activated' }
  | { status: 'aborted' }
  | { status: 'failed'; error: unknown };

export type TabActivationCoordinatorOptions = {
  tab: TabData;
  ensureWorkspaceServices: () => Promise<boolean>;
  isTabAlive: () => boolean;
  renderHydrationState: (error?: unknown) => void;
  waitForPaint: () => Promise<void>;
  startHydrationProfile: () => { finish: () => void } | null;
};

/**
 * Coordinates the work that follows selecting a tab: provider workspace
 * readiness, conversation hydration, and the empty-tab welcome state.
 *
 * Tab collection membership and active-tab selection remain owned by
 * TabManager. Keeping this flow behind a narrow boundary makes activation
 * ordering testable without giving the coordinator authority over tabs.
 */
export async function activateTabContent(
  options: TabActivationCoordinatorOptions,
): Promise<TabActivationResult> {
  const {
    tab,
    ensureWorkspaceServices,
    isTabAlive,
    renderHydrationState,
    waitForPaint,
    startHydrationProfile,
  } = options;
  const needsHydration = !!tab.conversationId && tab.hydrationState !== 'ready';

  if (needsHydration) {
    tab.hydrationState = 'loading';
    renderHydrationState();
    await waitForPaint();
    if (!isTabAlive()) return { status: 'aborted' };
  }

  try {
    if (!await ensureWorkspaceServices()) {
      return { status: 'aborted' };
    }

    if (needsHydration && tab.conversationId) {
      const profile = startHydrationProfile();
      try {
        const runtime = tab.session;
        const work = runtime?.hydrationWork ?? Promise.resolve(tab.controllers.conversationController?.switchTo(tab.conversationId));
        if (runtime) runtime.hydrationWork = work;
        try {
          await work;
          tab.hydrationState = 'ready';
        } finally {
          if (runtime?.hydrationWork === work) runtime.hydrationWork = null;
        }
      } finally {
        profile?.finish();
      }
      if (!isTabAlive()) return { status: 'aborted' };
      tab.hydrationState = 'ready';
    } else if (tab.conversationId && tab.state.messages.length > 0) {
      tab.hydrationState = 'ready';
    } else if (!tab.conversationId && tab.state.messages.length === 0) {
      tab.controllers.conversationController?.initializeWelcome();
      tab.hydrationState = 'ready';
    }
  } catch (error) {
    tab.hydrationState = 'failed';
    if (!isTabAlive()) return { status: 'aborted' };
    renderHydrationState(error);
    return { status: 'failed', error };
  }

  return isTabAlive() ? { status: 'activated' } : { status: 'aborted' };
}
