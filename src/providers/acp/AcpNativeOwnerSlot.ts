/**
 * The single native process owner of an ACP session: one startup at a time, shared by concurrent
 * callers, and a shutdown that also stops whatever an in-flight startup installs.
 */
export class AcpNativeOwnerSlot<TOwner> {
  private owner: TOwner | null = null;
  private startup: Promise<TOwner> | null = null;

  constructor(
    private readonly release: (owner: TOwner, wasCurrent: boolean) => Promise<void>,
  ) {}

  get current(): TOwner | null {
    return this.owner;
  }

  isCurrent(owner: TOwner): boolean {
    return this.owner === owner;
  }

  install(owner: TOwner): void {
    this.owner = owner;
  }

  ensure(
    reusable: (owner: TOwner) => boolean,
    start: () => Promise<TOwner>,
  ): Promise<TOwner> {
    const owner = this.owner;
    if (!this.startup && owner && reusable(owner)) return Promise.resolve(owner);
    let startup = this.startup;
    if (!startup) {
      startup = start();
      this.startup = startup;
      const clear = (): void => {
        if (this.startup === startup) this.startup = null;
      };
      startup.then(clear, clear);
    }
    return startup;
  }

  detach(owner: TOwner): Promise<void> {
    const wasCurrent = this.owner === owner;
    if (wasCurrent) this.owner = null;
    return this.release(owner, wasCurrent);
  }

  async shutdown(): Promise<void> {
    const startup = this.startup;
    const failures: unknown[] = [];
    const stop = (target: TOwner | null): Promise<void> | undefined =>
      target
        ? this.detach(target).catch((error: unknown) => { failures.push(error); })
        : undefined;
    await stop(this.owner);
    if (startup) await startup.catch(() => undefined);
    await stop(this.owner);
    if (failures.length > 0) {
      const [failure] = failures;
      throw failure instanceof Error ? failure : new Error(String(failure));
    }
  }
}
