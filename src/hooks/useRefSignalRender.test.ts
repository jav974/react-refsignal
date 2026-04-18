/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { setupRafMock } from '../test-utils/raf';
import { createRefSignal, RefSignal } from '../refsignal';
import { useRefSignal } from './useRefSignal';
import { useRefSignalRender } from './useRefSignalRender';

// ─── Test helpers ────────────────────────────────────────────────────────────

type RenderDeps = Parameters<typeof useRefSignalRender>[0];
type RenderOptions = Parameters<typeof useRefSignalRender>[1];

/**
 * Mount a component that uses `useRefSignalRender` with pre-created signals.
 * Returns `result` (the forceUpdate fn), a counter accessor, and lifecycle.
 */
function renderWithSignals(deps: RenderDeps, options?: RenderOptions) {
  let count = 0;
  const { result, rerender, unmount } = renderHook(() => {
    count++;
    return useRefSignalRender(deps, options);
  });
  return {
    renders: () => count,
    forceUpdate: result,
    rerender,
    unmount,
  };
}

// ─── Core behavior ───────────────────────────────────────────────────────────

describe('useRefSignalRender', () => {
  it('should not re-render on initial mount', () => {
    const signal = createRefSignal(1);
    const { renders } = renderWithSignals([signal]);
    expect(renders()).toBe(1);
  });

  it('should re-render when signal value changes', () => {
    const signal = createRefSignal(1);
    const { renders } = renderWithSignals([signal]);

    act(() => {
      signal.update(2);
    });

    expect(renders()).toBe(2);
  });

  it('should re-render only if callback returns true', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], () => signal.current >= 2);

    act(() => {
      signal.update(1);
    });
    expect(renders()).toBe(1);

    act(() => {
      signal.update(2);
    });
    expect(renders()).toBe(2);
  });

  it('should re-render when calling the returned forceUpdate', () => {
    const signal = createRefSignal(0);
    const { renders, forceUpdate } = renderWithSignals([signal]);

    expect(renders()).toBe(1);

    act(() => {
      forceUpdate.current();
    });

    expect(renders()).toBe(2);
  });

  describe('notify() vs notifyUpdate()', () => {
    it('should not re-render when notify() is called — snapshot unchanged', () => {
      const signal = createRefSignal(0);
      const { renders } = renderWithSignals([signal]);

      act(() => {
        signal.notify();
      });

      expect(renders()).toBe(1);
    });

    it('should re-render when notifyUpdate() is called — snapshot changes', () => {
      const signal = createRefSignal(0);
      const { renders } = renderWithSignals([signal]);

      act(() => {
        signal.notifyUpdate();
      });

      expect(renders()).toBe(2);
    });

    it('notify() still fires useRefSignalEffect listeners', () => {
      const signal = createRefSignal(0);
      const listener = jest.fn();

      signal.subscribe(listener);
      act(() => {
        signal.notify();
      });
      signal.unsubscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  it('should resubscribe when deps array changes', () => {
    // Keeps its own mount scaffolding because it uses `useRefSignal` inside
    // the hook plus a props-based rerender — doesn't fit the shared helper.
    let renderCount = 0;

    const { result, rerender } = renderHook(
      ({ useSignalA }: { useSignalA: boolean }) => {
        renderCount++;
        const signalA = useRefSignal(0);
        const signalB = useRefSignal(0);
        useRefSignalRender(useSignalA ? [signalA] : [signalB]);
        return { signalA, signalB };
      },
      { initialProps: { useSignalA: true } },
    );

    expect(renderCount).toBe(1);

    act(() => {
      result.current.signalA.update(1);
    });
    expect(renderCount).toBe(2);

    rerender({ useSignalA: false });
    expect(renderCount).toBe(3);

    act(() => {
      result.current.signalA.update(2);
    });
    expect(renderCount).toBe(3); // no change

    act(() => {
      result.current.signalB.update(1);
    });
    expect(renderCount).toBe(4);
  });
});

// ─── Timing options ──────────────────────────────────────────────────────────

describe('useRefSignalRender — timing options', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('legacy callback API still works', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], () => signal.current >= 2);

    act(() => {
      signal.update(1);
    });
    expect(renders()).toBe(1);

    act(() => {
      signal.update(2);
    });
    expect(renders()).toBe(2);
  });

  it('throttle: rapid updates produce at most leading + one trailing render', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], { throttle: 100 });

    expect(renders()).toBe(1);

    act(() => {
      signal.update(1);
    });
    expect(renders()).toBe(2); // leading

    act(() => {
      signal.update(2);
      signal.update(3);
      signal.update(4);
    });
    expect(renders()).toBe(2); // throttled

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renders()).toBe(3); // trailing
  });

  it('throttle: updates after the window fire immediately again', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], { throttle: 100 });

    act(() => {
      signal.update(1);
    });
    expect(renders()).toBe(2);

    act(() => {
      jest.advanceTimersByTime(100);
    });
    act(() => {
      signal.update(2);
    });
    expect(renders()).toBe(3);
  });

  it('debounce: rapid updates produce one render after quiet period', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], { debounce: 100 });

    act(() => {
      signal.update(1);
      signal.update(2);
      signal.update(3);
    });
    expect(renders()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renders()).toBe(2);
  });

  it('debounce: resets timer on each update', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], { debounce: 100 });

    act(() => {
      signal.update(1);
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    act(() => {
      signal.update(2);
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(renders()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(renders()).toBe(2);
  });

  it('debounce + maxWait: guarantees flush even if signal keeps firing', () => {
    const signal = createRefSignal(0);
    const { renders } = renderWithSignals([signal], {
      debounce: 100,
      maxWait: 250,
    });

    for (let i = 1; i <= 5; i++) {
      act(() => {
        signal.update(i);
      });
      act(() => {
        jest.advanceTimersByTime(50);
      });
    }

    expect(renders()).toBe(2);
  });

  it('rAF: coalesces any number of updates per frame into one render', () => {
    const raf = setupRafMock();

    try {
      const signal = createRefSignal(0);
      const { renders } = renderWithSignals([signal], { rAF: true });
      const fireFrame = () => {
        act(() => {
          raf.fire();
        });
      };

      // Single update — render deferred until the frame fires
      act(() => {
        signal.update(1);
      });
      expect(renders()).toBe(1);
      fireFrame();
      expect(renders()).toBe(2);

      // Burst of updates in one frame — still exactly one render
      act(() => {
        signal.update(2);
        signal.update(3);
        signal.update(4);
      });
      expect(renders()).toBe(2);
      fireFrame();
      expect(renders()).toBe(3);
    } finally {
      raf.restore();
    }
  });

  it('forceUpdate bypasses timing options', () => {
    const signal = createRefSignal(0);
    const { renders, forceUpdate } = renderWithSignals([signal], {
      debounce: 1000,
    });

    act(() => {
      forceUpdate.current();
    });
    expect(renders()).toBe(2);
  });

  it('cleanup cancels pending timer on unmount', () => {
    const signal = createRefSignal(0);
    const { unmount } = renderWithSignals([signal], { debounce: 100 });

    act(() => {
      signal.update(1);
    });
    unmount();

    // No error if the timer would have fired after unmount
    act(() => {
      jest.advanceTimersByTime(200);
    });
  });
});

// ─── Dynamic signal tracking ─────────────────────────────────────────────────

describe('useRefSignalRender — trackSignals option', () => {
  it('re-renders when a dynamically-tracked signal updates', () => {
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');
    const { renders } = renderWithSignals([outer], {
      trackSignals: () => [inner],
    });

    expect(renders()).toBe(1);

    act(() => {
      inner.update('b');
    });

    expect(renders()).toBe(2);
  });

  it('swaps dynamic subscription when static dep fires', () => {
    const innerA = createRefSignal(0);
    const innerB = createRefSignal(100);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', innerA]]),
    );
    const { renders } = renderWithSignals([nodes], {
      trackSignals: () => {
        const s = nodes.current.get('a');
        return s ? [s] : [];
      },
    });

    expect(renders()).toBe(1);

    // Swap inner — static fire reconciles, also triggers re-render
    act(() => {
      const m = new Map(nodes.current);
      m.set('a', innerB);
      nodes.update(m);
    });
    expect(renders()).toBe(2);

    // innerA no longer drives re-renders
    act(() => {
      innerA.update(999);
    });
    expect(renders()).toBe(2);

    // innerB does
    act(() => {
      innerB.update(42);
    });
    expect(renders()).toBe(3);
  });

  it('does NOT re-render on .notify() of a dynamically-tracked signal', () => {
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');
    const { renders } = renderWithSignals([outer], {
      trackSignals: () => [inner],
    });

    expect(renders()).toBe(1);

    act(() => {
      inner.notify();
    });
    expect(renders()).toBe(1);

    act(() => {
      inner.update('b');
    });
    expect(renders()).toBe(2);
  });

  it('cleanup unsubscribes from dynamically-tracked signals on unmount', () => {
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');
    const { renders, unmount } = renderWithSignals([outer], {
      trackSignals: () => [inner],
    });

    unmount();

    act(() => {
      inner.update('b');
    });

    expect(renders()).toBe(1);
  });
});
