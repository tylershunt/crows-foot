/** How long after a click automatic refreshes wait before changing the dashboard. */
export const QUIET_AFTER_CLICK_MS = 10_000;

/**
 * Holds automatic refresh results while the user is clicking: until `quietMs`
 * have passed since the last click, and for as long as any popover is open.
 */
export class RefreshHold {
  private lastClickAt: number | null = null;
  private openPopovers = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly quietMs = QUIET_AFTER_CLICK_MS,
    private readonly now: () => number = Date.now,
  ) {}

  click(): void {
    this.lastClickAt = this.now();
  }

  /** Holds results until the returned function is called. */
  openPopover(): () => void {
    this.openPopovers += 1;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.openPopovers -= 1;
      for (const wake of [...this.waiters]) wake();
    };
  }

  /** Milliseconds until the hold releases: `Infinity` while a popover is open, 0 once released. */
  remaining(): number {
    if (this.openPopovers > 0) return Infinity;
    if (this.lastClickAt === null) return 0;
    return Math.max(0, this.lastClickAt + this.quietMs - this.now());
  }

  /** Resolves once the hold releases. */
  async released(): Promise<void> {
    for (let wait = this.remaining(); wait > 0; wait = this.remaining()) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = wait === Infinity ? undefined : setTimeout(wake, wait);
        this.waiters.add(wake);
      });
    }
  }
}

export const refreshHold = new RefreshHold();
