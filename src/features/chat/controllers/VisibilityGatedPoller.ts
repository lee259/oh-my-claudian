type EventTargetLike = {
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

export interface VisibilityGatedPollerDocument extends EventTargetLike {
  readonly visibilityState?: DocumentVisibilityState;
}

export interface VisibilityGatedPollerWindow extends EventTargetLike {
  setInterval?: (handler: () => void, timeout: number) => number;
  clearInterval?: (handle: number) => void;
}

export interface VisibilityGatedPollerOptions {
  ownerDocument: VisibilityGatedPollerDocument;
  ownerWindow: VisibilityGatedPollerWindow;
  intervalMs: number;
  poll: () => void;
}

/**
 * Runs a polling callback only while its owning document is visible and its
 * window is focused. Keeping the timer stopped, rather than merely skipping
 * work inside the callback, avoids idle wakeups in background windows.
 */
export class VisibilityGatedPoller {
  private interval: number | null = null;
  private started = false;
  private windowBlurred = false;
  private readonly schedule: (handler: () => void, timeout: number) => number;
  private readonly cancelSchedule: (handle: number) => void;

  constructor(private readonly options: VisibilityGatedPollerOptions) {
    this.schedule = options.ownerWindow.setInterval
      ? options.ownerWindow.setInterval.bind(options.ownerWindow)
      : (handler, timeout) => window.setInterval(handler, timeout);
    this.cancelSchedule = options.ownerWindow.clearInterval
      ? options.ownerWindow.clearInterval.bind(options.ownerWindow)
      : handle => window.clearInterval(handle);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.windowBlurred = false;
    this.options.ownerDocument.addEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.options.ownerWindow.addEventListener?.('blur', this.handleWindowBlur);
    this.options.ownerWindow.addEventListener?.('focus', this.handleWindowFocus);
    this.sync();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.options.ownerDocument.removeEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.options.ownerWindow.removeEventListener?.('blur', this.handleWindowBlur);
    this.options.ownerWindow.removeEventListener?.('focus', this.handleWindowFocus);
    this.clearTimer();
  }

  isPolling(): boolean {
    return this.interval !== null;
  }

  isStarted(): boolean {
    return this.started;
  }

  private readonly handleVisibilityChange = (): void => {
    this.sync();
  };

  private readonly handleWindowBlur = (): void => {
    this.windowBlurred = true;
    this.sync();
  };

  private readonly handleWindowFocus = (): void => {
    this.windowBlurred = false;
    this.sync();
  };

  private sync(): void {
    if (!this.started) return;

    const shouldPoll = this.options.ownerDocument.visibilityState !== 'hidden'
      && !this.windowBlurred;
    if (shouldPoll) {
      if (this.interval === null) {
        this.interval = this.schedule(
          this.options.poll,
          this.options.intervalMs
        );
      }
      return;
    }

    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.interval === null) return;
    this.cancelSchedule(this.interval);
    this.interval = null;
  }
}
