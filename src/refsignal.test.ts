import {
  createRefSignal,
  isRefSignal,
  batch,
  CANCEL,
  createComputedRefSignal,
  watch,
  listenersMap,
} from './refsignal';
import { setupRafMock } from './test-utils/raf';

describe('createRefSignal', () => {
  it('should create a RefSignal with initial value', () => {
    const signal = createRefSignal(42);
    expect(signal.current).toBe(42);
    expect(typeof signal.subscribe).toBe('function');
    expect(typeof signal.unsubscribe).toBe('function');
    expect(typeof signal.update).toBe('function');
    expect(typeof signal.notify).toBe('function');
    expect(typeof signal.notifyUpdate).toBe('function');
  });

  it('should satisfy isRefSignal', () => {
    const signal = createRefSignal('test');
    expect(isRefSignal(signal)).toBe(true);
  });

  it('should not satisfy isRefSignal', () => {
    const signal = { current: 'test' };
    expect(isRefSignal(signal)).toBe(false);
  });

  it('accepts debugName as a string (backward compat)', () => {
    const signal = createRefSignal(0, 'mySignal');
    expect(signal.current).toBe(0);
  });

  describe('equal option', () => {
    it('skips update when equal returns true', () => {
      const signal = createRefSignal(
        { x: 0, y: 0 },
        {
          equal: (a, b) => a.x === b.x && a.y === b.y,
        },
      );
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update({ x: 0, y: 0 }); // different reference, same values
      expect(listener).not.toHaveBeenCalled();
      expect(signal.lastUpdated).toBe(0);
    });

    it('fires update when equal returns false', () => {
      const signal = createRefSignal(
        { x: 0 },
        {
          equal: (a, b) => a.x === b.x,
        },
      );
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update({ x: 1 });
      expect(listener).toHaveBeenCalledWith({ x: 1 });
    });

    it('equal runs after interceptor', () => {
      const signal = createRefSignal(0, {
        interceptor: (v) => Math.abs(v),
        equal: (a, b) => a === b,
      });
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update(-5); // interceptor → 5, equal(5, 0) → false, update fires
      expect(signal.current).toBe(5);
      expect(listener).toHaveBeenCalledWith(5);
      signal.update(-5); // interceptor → 5, equal(5, 5) → true, skipped
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('interceptor option', () => {
    it('transforms the incoming value', () => {
      const signal = createRefSignal(0, {
        interceptor: (incoming) => Math.max(0, incoming),
      });
      signal.update(-5);
      expect(signal.current).toBe(0);
    });

    it('intercepted value is what subscribers receive', () => {
      const signal = createRefSignal(5, {
        interceptor: (incoming) => Math.max(0, incoming),
      });
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update(-5); // interceptor clamps to 0, different from current (5)
      expect(listener).toHaveBeenCalledWith(0);
    });

    it('is a no-op when intercepted value equals current', () => {
      const signal = createRefSignal(0, {
        interceptor: (incoming) => Math.max(0, incoming),
      });
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update(-99); // clamps to 0, which equals current
      expect(listener).not.toHaveBeenCalled();
      expect(signal.current).toBe(0);
    });

    it('cancels the update when CANCEL is returned', () => {
      const signal = createRefSignal(5, {
        interceptor: (incoming) => (incoming < 0 ? CANCEL : incoming),
      });
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update(-1);
      expect(listener).not.toHaveBeenCalled();
      expect(signal.current).toBe(5);
      expect(signal.lastUpdated).toBe(0);
    });

    it('CANCEL works for undefined values', () => {
      const signal = createRefSignal<number | undefined>(undefined, {
        interceptor: (incoming) => (incoming === undefined ? CANCEL : incoming),
      });
      signal.update(undefined);
      expect(signal.current).toBe(undefined);
      expect(signal.lastUpdated).toBe(0);
    });

    it('can use current value for delta-based logic', () => {
      const signal = createRefSignal(0, {
        interceptor: (incoming, current) =>
          current + Math.min(incoming - current, 10),
      });
      signal.update(100); // delta is 100, capped to 10
      expect(signal.current).toBe(10);
    });

    it('propagates a throwing interceptor out of update', () => {
      const signal = createRefSignal(5, {
        interceptor: (incoming) => {
          if (incoming < 0) throw new RangeError('negative');
          return incoming;
        },
      });
      expect(() => {
        signal.update(-1);
      }).toThrow(RangeError);
      expect(signal.current).toBe(5);
    });

    it('accepts debugName alongside interceptor', () => {
      const signal = createRefSignal(10, {
        interceptor: (v) => v * 2,
        debugName: 'doubled',
      });
      signal.update(5);
      expect(signal.current).toBe(10);
    });

    it('satisfies isRefSignal', () => {
      const signal = createRefSignal(0, { interceptor: (v) => v });
      expect(isRefSignal(signal)).toBe(true);
    });

    it('applies interceptor to initial value', () => {
      const signal = createRefSignal(-5, {
        interceptor: (v) => Math.max(0, v),
      });
      expect(signal.current).toBe(0);
    });

    it('falls back to initialValue when interceptor returns CANCEL on mount', () => {
      const signal = createRefSignal(-1, {
        interceptor: (v) => (v < 0 ? CANCEL : v),
      });
      expect(signal.current).toBe(-1);
    });
  });

  describe('reset', () => {
    it('restores initial value and notifies subscribers', () => {
      const signal = createRefSignal(10);
      const listener = jest.fn();
      signal.update(42);
      signal.subscribe(listener);
      signal.reset();
      expect(signal.current).toBe(10);
      expect(listener).toHaveBeenCalledWith(10);
    });

    it('is a no-op if current already equals initial value', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.reset();
      expect(listener).not.toHaveBeenCalled();
    });

    it('respects the interceptor on reset', () => {
      const signal = createRefSignal(5, {
        interceptor: (incoming, current) =>
          incoming <= current ? CANCEL : incoming,
      });
      signal.update(10);
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.reset(); // tries to go back to 5, but 5 <= 10 → CANCEL
      expect(signal.current).toBe(10);
      expect(listener).not.toHaveBeenCalled();
    });

    it('resets to intercepted initial value, not raw initial value', () => {
      const signal = createRefSignal(-5, {
        interceptor: (v) => Math.max(0, v),
      });
      // safeInitial is 0 (interceptor applied at mount)
      signal.update(99);
      signal.reset();
      expect(signal.current).toBe(0);
    });
  });

  describe('dispose', () => {
    it('clears subscribers — listener no longer fires after dispose', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.dispose();
      signal.update(1);
      expect(listener).not.toHaveBeenCalled();
    });

    it('allows re-subscribing after dispose', () => {
      const signal = createRefSignal(0);
      signal.dispose();
      const listener = jest.fn();
      signal.subscribe(listener);
      signal.update(1);
      expect(listener).toHaveBeenCalledWith(1);
    });

    it('runs broadcast adapter cleanup on dispose', async () => {
      await jest.isolateModulesAsync(async () => {
        const { setSignalBroadcastAdapter, createRefSignal: create } =
          await import('./refsignal');
        const cleanup = jest.fn();
        setSignalBroadcastAdapter({ attach: () => cleanup });
        const signal = create(0, { broadcast: 'channel' });
        signal.dispose();
        expect(cleanup).toHaveBeenCalledTimes(1);
      });
    });

    it('runs persist adapter cleanup on dispose', async () => {
      await jest.isolateModulesAsync(async () => {
        const { setSignalPersistAdapter, createRefSignal: create } =
          await import('./refsignal');
        const cleanup = jest.fn();
        setSignalPersistAdapter({ attach: () => cleanup });
        const signal = create(0, { persist: 'my-key' });
        signal.dispose();
        expect(cleanup).toHaveBeenCalledTimes(1);
      });
    });

    it('is idempotent — second dispose does not re-run cleanups', async () => {
      await jest.isolateModulesAsync(async () => {
        const { setSignalBroadcastAdapter, createRefSignal: create } =
          await import('./refsignal');
        const cleanup = jest.fn();
        setSignalBroadcastAdapter({ attach: () => cleanup });
        const signal = create(0, { broadcast: 'channel' });
        signal.dispose();
        signal.dispose();
        expect(cleanup).toHaveBeenCalledTimes(1);
      });
    });

    it('supports re-attaching listeners and adapters after dispose', async () => {
      await jest.isolateModulesAsync(async () => {
        const {
          setSignalBroadcastAdapter,
          setSignalPersistAdapter,
          attachSignalBroadcast,
          attachSignalPersist,
          createRefSignal: create,
        } = await import('./refsignal');

        const broadcastCleanup = jest.fn();
        const persistCleanup = jest.fn();
        setSignalBroadcastAdapter({ attach: () => broadcastCleanup });
        setSignalPersistAdapter({ attach: () => persistCleanup });

        const signal = create(0, { broadcast: 'channel', persist: 'key' });
        const original = jest.fn();
        signal.subscribe(original);

        signal.dispose();
        expect(broadcastCleanup).toHaveBeenCalledTimes(1);
        expect(persistCleanup).toHaveBeenCalledTimes(1);

        // Re-attach: signal isn't permanently dead, just released.
        const replacement = jest.fn();
        signal.subscribe(replacement);
        const reBroadcastCleanup = attachSignalBroadcast(signal, 'channel');
        const rePersistCleanup = attachSignalPersist(signal, 'key');

        signal.update(42);
        expect(original).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledWith(42);

        // Cleanups returned from the re-attach are independent of the signal —
        // calling them tears down only that re-attached binding, listeners stay.
        reBroadcastCleanup?.();
        rePersistCleanup?.();
        expect(broadcastCleanup).toHaveBeenCalledTimes(2);
        expect(persistCleanup).toHaveBeenCalledTimes(2);

        signal.update(99);
        expect(replacement).toHaveBeenCalledWith(99);
      });
    });
  });
});

describe('subscribe/unsubscribe/notify', () => {
  it('should call listener on notify', () => {
    const signal = createRefSignal('hello');
    const listener = jest.fn();
    signal.subscribe(listener);

    signal.notify();
    expect(listener).toHaveBeenCalledWith('hello');
  });

  it('should not call unsubscribed listener', () => {
    const signal = createRefSignal('bye');
    const listener = jest.fn();
    signal.subscribe(listener);
    signal.unsubscribe(listener);

    signal.notify();
    expect(listener).not.toHaveBeenCalled();
  });

  it('should call listeners on notify', () => {
    const signal = createRefSignal('hello');
    const listener = jest.fn();
    const listener2 = jest.fn();
    signal.subscribe(listener);
    signal.subscribe(listener2);

    signal.notify();
    expect(listener).toHaveBeenCalledWith('hello');
    expect(listener2).toHaveBeenCalledWith('hello');
  });

  it('should handle listener exceptions and log error', () => {
    const signal = createRefSignal('test');
    const goodListener = jest.fn();
    const badListener = jest.fn(() => {
      throw new Error('Listener error');
    });

    signal.subscribe(goodListener);
    signal.subscribe(badListener);

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    signal.notify();

    expect(goodListener).toHaveBeenCalledWith('test');
    expect(badListener).toHaveBeenCalledWith('test');
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe('notify/notifyUpdate', () => {
  it('should update lastUpdated timestamp when notifyUpdate is called', () => {
    const signal = createRefSignal(1);
    expect(signal.lastUpdated).toBe(0);

    signal.notifyUpdate();
    expect(signal.lastUpdated).not.toBe(0);
  });

  it('should not update lastUpdated timestamp when notify is called', () => {
    const signal = createRefSignal(1);
    expect(signal.lastUpdated).toBe(0);

    signal.notify();
    expect(signal.lastUpdated).toBe(0);
  });
});

describe('update', () => {
  it('should update value and notify listeners', () => {
    const signal = createRefSignal(1);
    const listener = jest.fn();
    signal.subscribe(listener);

    signal.update(2);
    expect(signal.current).toBe(2);
    expect(listener).toHaveBeenCalledWith(2);
  });

  it('should not notify if value is unchanged', () => {
    const signal = createRefSignal(5);
    const listener = jest.fn();
    signal.subscribe(listener);

    signal.update(5);
    expect(listener).not.toHaveBeenCalled();
  });

  it('should update lastUpdated property when updated', () => {
    const signal = createRefSignal(5);
    const currentTimestamp = signal.lastUpdated;

    expect(currentTimestamp).toBe(0);

    const listener = jest.fn();
    signal.subscribe(listener);

    signal.update(1);
    expect(signal.lastUpdated).not.toBe(currentTimestamp);
  });
});

describe('lastUpdated uniqueness', () => {
  it('should produce distinct lastUpdated values for rapid consecutive updates within the same millisecond', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);

    const signal = createRefSignal(0);
    signal.update(1);
    const first = signal.lastUpdated;

    signal.update(2);
    const second = signal.lastUpdated;

    jest.restoreAllMocks();

    expect(second).not.toBe(first);
  });
});

describe('batch', () => {
  it('should defer notifications until after batch', () => {
    const signalA = createRefSignal(1);
    const signalB = createRefSignal(2);
    const listenerA = jest.fn();
    const listenerB = jest.fn();

    signalA.subscribe(listenerA);
    signalB.subscribe(listenerB);

    batch(() => {
      signalA.update(10);
      signalB.update(20);
      // Listeners should not be called yet
      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).not.toHaveBeenCalled();
    }, [signalA, signalB]);

    // After batch, listeners should be called
    expect(listenerA).toHaveBeenCalledWith(10);
    expect(listenerB).toHaveBeenCalledWith(20);
  });

  it('should cleanup batch stack even when callback throws error', () => {
    const signalA = createRefSignal(1);
    const signalB = createRefSignal(2);
    const listenerA = jest.fn();
    const listenerB = jest.fn();

    signalA.subscribe(listenerA);
    signalB.subscribe(listenerB);

    // First batch that throws an error
    expect(() => {
      batch(() => {
        signalA.update(10);
        throw new Error('Test error');
      }, [signalA]);
    }).toThrow('Test error');

    // Listeners should still be notified after error (finally block)
    expect(listenerA).toHaveBeenCalledWith(10);

    listenerA.mockClear();
    listenerB.mockClear();

    // Second batch should work normally (stack not corrupted)
    batch(() => {
      signalB.update(20);
      expect(listenerB).not.toHaveBeenCalled();
    }, [signalB]);

    expect(listenerB).toHaveBeenCalledWith(20);
  });
});

// ─── createComputedRefSignal ─────────────────────────────────────────────────────

describe('createComputedRefSignal', () => {
  it('initialises with the computed value', () => {
    const a = createRefSignal(2);
    const b = createRefSignal(3);
    const product = createComputedRefSignal(
      () => a.current * b.current,
      [a, b],
    );
    expect(product.current).toBe(6);
  });

  it('recomputes when a dep updates', () => {
    const a = createRefSignal(2);
    const b = createRefSignal(3);
    const product = createComputedRefSignal(
      () => a.current * b.current,
      [a, b],
    );
    a.update(5);
    expect(product.current).toBe(15);
  });

  it('notifies subscribers on recompute', () => {
    const source = createRefSignal(1);
    const doubled = createComputedRefSignal(() => source.current * 2, [source]);
    const listener = jest.fn();
    doubled.subscribe(listener);
    source.update(4);
    expect(listener).toHaveBeenCalledWith(8);
  });

  it('does not recompute when value is unchanged', () => {
    const source = createRefSignal(0);
    const compute = jest.fn(() => Math.abs(source.current));
    const abs = createComputedRefSignal(compute, [source]);
    compute.mockClear();
    source.update(0); // same value — update() is a no-op on source
    expect(compute).not.toHaveBeenCalled();
    expect(abs.current).toBe(0);
  });

  it('stops recomputing after dispose', () => {
    const source = createRefSignal(1);
    const doubled = createComputedRefSignal(() => source.current * 2, [source]);
    doubled.dispose();
    source.update(5);
    expect(doubled.current).toBe(2); // frozen at initial value
  });

  it('dispose does not affect other subscribers', () => {
    const source = createRefSignal(1);
    const doubled = createComputedRefSignal(() => source.current * 2, [source]);
    const listener = jest.fn();
    source.subscribe(listener);
    doubled.dispose();
    source.update(10);
    expect(listener).toHaveBeenCalledWith(10); // other subscribers unaffected
  });

  it('dispose clears subscribers on the computed signal itself', () => {
    const source = createRefSignal(1);
    const doubled = createComputedRefSignal(() => source.current * 2, [source]);
    const listener = jest.fn();
    doubled.subscribe(listener);
    doubled.dispose();
    // Even if something forced a value through (e.g. another computed sharing state),
    // prior subscribers must not fire. The contract is "after dispose, subscribers are released."
    expect(listenersMap.has(doubled)).toBe(false);
  });
});

// ─── watch ────────────────────────────────────────────────────────────────────

describe('watch', () => {
  it('calls the listener when the signal updates', () => {
    const signal = createRefSignal(0);
    const listener = jest.fn();
    watch(signal, listener);
    signal.update(42);
    expect(listener).toHaveBeenCalledWith(42);
  });

  it('does not call the listener immediately', () => {
    const signal = createRefSignal(0);
    const listener = jest.fn();
    watch(signal, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops listening after the returned cleanup is called', () => {
    const signal = createRefSignal(0);
    const listener = jest.fn();
    const stop = watch(signal, listener);
    stop();
    signal.update(1);
    expect(listener).not.toHaveBeenCalled();
  });

  describe('watch — timing options', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('throttle: rate-limits the listener', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();
      watch(signal, listener, { throttle: 100 });
      signal.update(1); // leading
      signal.update(2);
      signal.update(3); // trailing pending
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(1);
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenLastCalledWith(3); // latest value
    });

    it('debounce: fires after quiet period with latest value', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();
      watch(signal, listener, { debounce: 100 });
      signal.update(1);
      signal.update(2);
      signal.update(3);
      expect(listener).not.toHaveBeenCalled();
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(3);
    });

    it('rAF: collapses updates into one call per frame', () => {
      const raf = setupRafMock();
      try {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        watch(signal, listener, { rAF: true });
        signal.update(1);
        signal.update(2);
        expect(listener).not.toHaveBeenCalled();
        raf.fire();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(2);
      } finally {
        raf.restore();
      }
    });

    it('stop() cancels a pending timer', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();
      const stop = watch(signal, listener, { debounce: 100 });
      signal.update(1);
      stop();
      jest.advanceTimersByTime(200);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('watch — filter option', () => {
    it('skips the listener when filter returns false', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();
      watch(signal, listener, { filter: () => signal.current > 5 });
      signal.update(3); // filtered out
      expect(listener).not.toHaveBeenCalled();
      signal.update(10); // passes
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(10);
    });

    it('filter + throttle: filter runs at fire time', () => {
      jest.useFakeTimers();
      const signal = createRefSignal(0);
      const listener = jest.fn();
      watch(signal, listener, {
        throttle: 100,
        filter: () => signal.current > 5,
      });
      signal.update(1); // leading — but filter blocks it (signal.current=1 at fire time)
      expect(listener).not.toHaveBeenCalled();
      signal.update(10); // trailing pending
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(10);
      jest.useRealTimers();
    });
  });
});

// ─── adapter missing warnings ─────────────────────────────────────────────────

describe('adapter missing warnings', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when broadcast option is used without the adapter', async () => {
    await jest.isolateModulesAsync(async () => {
      const { createRefSignal: create } = await import('./refsignal');
      create(0, { broadcast: 'channel' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('react-refsignal/broadcast'),
      );
    });
  });

  it('warns when persist option is used without the adapter', async () => {
    await jest.isolateModulesAsync(async () => {
      const { createRefSignal: create } = await import('./refsignal');
      create(0, { persist: 'my-key' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('react-refsignal/persist'),
      );
    });
  });

  it('warns only once per missing adapter type', async () => {
    await jest.isolateModulesAsync(async () => {
      const { createRefSignal: create } = await import('./refsignal');
      create(0, { broadcast: 'ch1' });
      create(0, { broadcast: 'ch2' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('does not warn when the broadcast adapter is registered', async () => {
    await jest.isolateModulesAsync(async () => {
      // Destructure rather than accessing via a namespace variable — some
      // IDEs don't narrow `await import('./refsignal')` correctly when
      // members are accessed through the namespace object.
      const { setSignalBroadcastAdapter, createRefSignal: create } =
        await import('./refsignal');
      // Simulates `import 'react-refsignal/broadcast'` which calls
      // setSignalBroadcastAdapter internally. Direct setter avoids pulling
      // in transport infrastructure — the real activation path is tested
      // in broadcast.test.ts.
      setSignalBroadcastAdapter({ attach: () => () => {} });
      create(0, { broadcast: 'channel' });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  it('does not warn when the persist adapter is registered', async () => {
    await jest.isolateModulesAsync(async () => {
      const { setSignalPersistAdapter, createRefSignal: create } = await import(
        './refsignal'
      );
      // Simulates `import 'react-refsignal/persist'`. Direct setter avoids
      // pulling in storage infrastructure — the real activation path is
      // tested in persist.test.ts.
      setSignalPersistAdapter({ attach: () => () => {} });
      create(0, { persist: 'my-key' });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
