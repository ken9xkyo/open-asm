interface Slot<T> {
  /** Settles when the last scheduled task of this key settles. */
  tail: Promise<unknown>;
  /** The scheduled task that has not started yet, if any. */
  queued: Promise<T> | null;
  /** Scheduled tasks that have not settled yet; the slot is dropped at 0. */
  pending: number;
}

/**
 * Runs at most one task per key at a time, and folds every request that
 * arrives while one is running into a single follow-up.
 *
 * Meant for idempotent "recompute from the database" tasks: a follow-up starts
 * only after the running task settled, so it sees everything the callers it
 * absorbed would have seen. Callers that join a queued follow-up share its
 * result (or its rejection).
 */
export class KeyedCoalescer<T> {
  private readonly slots = new Map<string, Slot<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const slot = this.slots.get(key) ?? {
      tail: Promise.resolve(),
      queued: null,
      pending: 0,
    };
    if (slot.queued) return slot.queued;

    const result: Promise<T> = slot.tail.then(() => {
      // Started: a request from now on must wait for a new follow-up.
      if (slot.queued === result) slot.queued = null;
      return task();
    });
    slot.queued = result;
    slot.tail = result.catch(() => undefined);
    slot.pending++;
    this.slots.set(key, slot);

    void slot.tail.then(() => {
      if (--slot.pending === 0 && this.slots.get(key) === slot) {
        this.slots.delete(key);
      }
    });
    return result;
  }

  /** Keys with a running or queued task. */
  get size(): number {
    return this.slots.size;
  }
}
