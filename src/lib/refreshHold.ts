/** How long after a click automatic refreshes wait before changing the dashboard. */
export const QUIET_AFTER_CLICK_MS = 10_000;

/**
 * Holds refresh results while the user is working: until `quietMs` have passed
 * since the last click, and for as long as any hold is taken.
 */
export class RefreshHold {
  private lastClickAt: number | null = null;
  private holds = 0;
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly quietMs = QUIET_AFTER_CLICK_MS,
    private readonly now: () => number = Date.now,
  ) {}

  click(): void {
    this.lastClickAt = this.now();
  }

  /** Holds results until the returned function is called. */
  hold(): () => void {
    this.holds += 1;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.holds -= 1;
      for (const wake of [...this.waiters]) wake();
    };
  }

  /** Milliseconds until the hold releases: `Infinity` while a hold is taken, 0 once released. */
  remaining(): number {
    if (this.holds > 0) return Infinity;
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

/** Resolves once every one of `holds` is released at the same moment. */
export async function allReleased(holds: RefreshHold[]): Promise<void> {
  for (let held = holds.find((hold) => hold.remaining() > 0); held; held = holds.find((hold) => hold.remaining() > 0)) {
    await held.released();
  }
}

/** Holds automatic refreshes after clicks and while a popover is open. */
export const refreshHold = new RefreshHold();

/** Holds every refresh while pull requests are selected. */
export const selectionHold = new RefreshHold(0);
