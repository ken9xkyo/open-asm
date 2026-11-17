import { KeyedCoalescer } from './keyed-coalescer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('KeyedCoalescer', () => {
  it('folds requests that arrive during a run into one follow-up', async () => {
    const coalescer = new KeyedCoalescer<number>();
    const first = deferred<number>();
    let calls = 0;
    const task = () => {
      calls++;
      return calls === 1 ? first.promise : Promise.resolve(calls);
    };

    const running = coalescer.run('run-1', task);
    await Promise.resolve();
    const followUps = [1, 2, 3, 4].map(() => coalescer.run('run-1', task));

    expect(calls).toBe(1);
    first.resolve(1);

    await expect(running).resolves.toBe(1);
    await expect(Promise.all(followUps)).resolves.toEqual([2, 2, 2, 2]);
    expect(calls).toBe(2);
    expect(coalescer.size).toBe(0);
  });

  it('never runs two tasks of one key at the same time', async () => {
    const coalescer = new KeyedCoalescer<void>();
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    };

    await Promise.all(
      Array.from({ length: 20 }, () => coalescer.run('run-1', task)),
    );

    expect(maxActive).toBe(1);
  });

  it('runs different keys independently', async () => {
    const coalescer = new KeyedCoalescer<string>();
    const blocked = deferred<string>();

    void coalescer.run('run-1', () => blocked.promise);
    await expect(
      coalescer.run('run-2', () => Promise.resolve('other')),
    ).resolves.toBe('other');

    blocked.resolve('done');
  });

  it('starts the follow-up after a failed run and shares its own outcome', async () => {
    const coalescer = new KeyedCoalescer<string>();
    const first = deferred<string>();

    const failing = coalescer.run('run-1', () => first.promise);
    await Promise.resolve();
    const followUp = coalescer.run('run-1', () => Promise.resolve('ok'));
    first.reject(new Error('boom'));

    await expect(failing).rejects.toThrow('boom');
    await expect(followUp).resolves.toBe('ok');
    expect(coalescer.size).toBe(0);
  });
});
