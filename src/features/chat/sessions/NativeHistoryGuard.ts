const OWNED_CHANGE_TIMEOUT_MS = 5_000;

/** Serializes revision checks and keeps changed history stale until a reload succeeds. */
export class NativeHistoryGuard {
  private revision: string | null = null;
  private stale = false;
  private observedUnavailable = false;
  private flight: Promise<boolean> | null = null;

  constructor(
    private readonly read: () => Promise<string | null>,
    private readonly refresh: () => Promise<boolean>,
    private readonly refreshInitialRevision = false,
    private readonly ownsChange?: (from: string, to: string) => Promise<boolean>,
  ) {}

  check(): Promise<boolean> {
    if (this.flight) return this.flight;
    const flight = this.checkOnce().catch(() => false).finally(() => {
      if (this.flight === flight) this.flight = null;
    });
    this.flight = flight;
    return flight;
  }

  private async checkOnce(): Promise<boolean> {
    const current = await this.read();
    if (current === null) {
      if (this.revision === null) this.observedUnavailable = true;
      return this.revision === null && !this.stale;
    }
    if (this.revision === null && !this.stale && !this.observedUnavailable && !this.refreshInitialRevision) {
      this.revision = current;
      return true;
    }
    if (current !== this.revision && this.revision !== null && await this.#owns(this.revision, current)) {
      this.revision = current;
      this.stale = false;
      return true;
    }
    if (current !== this.revision) this.stale = true;
    if (!this.stale) return true;
    if (!await this.refresh()) return false;
    const after = await this.read();
    if (after === null || after !== current) return false;
    this.revision = after;
    this.stale = false;
    return true;
  }

  async #owns(from: string, to: string): Promise<boolean> {
    if (!this.ownsChange) return false;
    let timer: number | undefined;
    const timeout = new Promise<false>(resolve => {
      timer = window.setTimeout(() => resolve(false), OWNED_CHANGE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        this.ownsChange(from, to).catch(() => false),
        timeout,
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  }
}
