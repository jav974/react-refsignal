/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { createRefSignal, RefSignal } from '../refsignal';
import { useRefSignal } from './useRefSignal';
import { useRefSignalMemo } from './useRefSignalMemo';

describe('useRefSignalMemo', () => {
  it('should initialize with value on initial mount', () => {
    const factory = jest.fn(() => 2);

    const { result } = renderHook(() => {
      const signal = useRefSignal(1);
      return useRefSignalMemo(factory, [signal]);
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.current.current).toBe(2);
  });

  it('should update value when signal dep changes', () => {
    const factory = jest.fn(() => 2);

    const { result } = renderHook(() => {
      const signal = useRefSignal(1);
      useRefSignalMemo(factory, [signal]);
      return signal;
    });

    act(() => {
      result.current.update(2);
    });

    expect(factory).toHaveBeenCalledTimes(2); // 1 on mount, 1 on signal update
  });

  it('should call factory exactly once when a non-signal dep changes', () => {
    const factory = jest.fn((n: number) => n * 2);

    const { rerender } = renderHook(
      ({ n }) => useRefSignalMemo(() => factory(n), [n]),
      { initialProps: { n: 1 } },
    );

    expect(factory).toHaveBeenCalledTimes(1); // mount

    rerender({ n: 2 });

    // Bug: currently 3 (useMemo calls factory, then useRefSignalEffect calls it again)
    expect(factory).toHaveBeenCalledTimes(2); // should be exactly 1 more call
  });

  it('should reflect correct value after non-signal dep change', () => {
    const { result, rerender } = renderHook(
      ({ multiplier }) => useRefSignalMemo(() => multiplier * 10, [multiplier]),
      { initialProps: { multiplier: 1 } },
    );

    expect(result.current.current).toBe(10);

    rerender({ multiplier: 5 });

    expect(result.current.current).toBe(50);
  });

  it('should call factory exactly once per change with mixed signal and non-signal deps', () => {
    const count = createRefSignal(1);
    const factory = jest.fn((n: number) => count.current * n);

    const { rerender } = renderHook(
      ({ n }) => useRefSignalMemo(() => factory(n), [count, n]),
      { initialProps: { n: 2 } },
    );

    expect(factory).toHaveBeenCalledTimes(1); // mount

    // Non-signal dep changes
    rerender({ n: 3 });
    expect(factory).toHaveBeenCalledTimes(2); // should be exactly 1 more, not 2

    // Signal dep changes
    act(() => {
      count.update(10);
    });
    expect(factory).toHaveBeenCalledTimes(3); // 1 more for the signal update
  });

  it('should use the latest factory closure when a signal fires after a non-signal dep change', () => {
    const count = createRefSignal(1);

    const { result, rerender } = renderHook(
      ({ multiplier }) =>
        useRefSignalMemo(() => count.current * multiplier, [count, multiplier]),
      { initialProps: { multiplier: 2 } },
    );

    expect(result.current.current).toBe(2); // 1 * 2

    rerender({ multiplier: 3 });
    expect(result.current.current).toBe(3); // 1 * 3

    // Signal fires after non-signal dep already changed — factory must use latest multiplier
    act(() => {
      count.update(5);
    });
    expect(result.current.current).toBe(15); // 5 * 3, not 5 * 2
  });

  it('should notify subscribers when value is updated via non-signal dep change', () => {
    const listener = jest.fn();

    const { result, rerender } = renderHook(
      ({ n }) => useRefSignalMemo(() => n * 2, [n]),
      { initialProps: { n: 1 } },
    );

    result.current.subscribe(listener);

    rerender({ n: 4 });

    expect(listener).toHaveBeenCalledWith(8);

    result.current.unsubscribe(listener);
  });

  // ─── trackSignals — nested-signal traversal ────────────────────────────

  it('follows a dynamically-tracked signal via trackSignals', () => {
    const inner = createRefSignal(10);
    const nodes = createRefSignal(new Map([['a', inner]]));

    const { result } = renderHook(() =>
      useRefSignalMemo(() => nodes.current.get('a')?.current ?? 0, [nodes], {
        trackSignals: () => {
          const s = nodes.current.get('a');
          return s ? [s] : [];
        },
      }),
    );

    expect(result.current.current).toBe(10);

    act(() => {
      inner.update(20);
    });

    expect(result.current.current).toBe(20);
  });

  it('swaps dynamic subscription when the static dep fires (identity swap)', () => {
    const innerA = createRefSignal(1);
    const innerB = createRefSignal(100);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', innerA]]),
    );

    const { result } = renderHook(() =>
      useRefSignalMemo(() => nodes.current.get('a')?.current ?? 0, [nodes], {
        trackSignals: () => {
          const s = nodes.current.get('a');
          return s ? [s] : [];
        },
      }),
    );

    expect(result.current.current).toBe(1);

    // Swap inner signal — fire static dep so reconcile picks up the new identity
    act(() => {
      const m = new Map(nodes.current);
      m.set('a', innerB);
      nodes.update(m);
    });

    expect(result.current.current).toBe(100);

    // innerA should no longer drive updates
    act(() => {
      innerA.update(999);
    });
    expect(result.current.current).toBe(100);

    // innerB now drives updates
    act(() => {
      innerB.update(42);
    });
    expect(result.current.current).toBe(42);
  });

  it('filter skips the factory recompute but keeps dynamic tracking consistent', () => {
    const signal = createRefSignal(1);
    const factory = jest.fn(() => signal.current * 10);
    let allow = false;

    const { result } = renderHook(() =>
      useRefSignalMemo(factory, [signal], { filter: () => allow }),
    );

    expect(result.current.current).toBe(10); // mount
    expect(factory).toHaveBeenCalledTimes(1);

    act(() => {
      signal.update(2);
    });

    // filter=false → value unchanged, factory NOT called for the fire
    expect(result.current.current).toBe(10);
    expect(factory).toHaveBeenCalledTimes(1);

    allow = true;
    act(() => {
      signal.update(3);
    });
    expect(result.current.current).toBe(30);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('handles trackSignals becoming undefined after mount without crashing', () => {
    // The watchOptions memo in useWatchArgs is keyed on timing values only,
    // so trackSignals changing identity (or disappearing) does not force a
    // resubscription — the captured getter keeps reading via ref. If the
    // caller re-renders with `trackSignals: undefined`, the ref becomes
    // nullish and the getter must tolerate that gracefully.
    const inner = createRefSignal('a');
    const outer = createRefSignal(0);

    const { rerender } = renderHook(
      ({ track }: { track: boolean }) =>
        useRefSignalMemo(() => outer.current, [outer], {
          trackSignals: track ? () => [inner] : undefined,
        }),
      { initialProps: { track: true } },
    );

    // Re-render with trackSignals disabled — ref is now undefined
    rerender({ track: false });

    // Static dep fire triggers reconcile; the getter reads a now-undefined
    // ref and must fall through the `?? []` guard without throwing.
    expect(() => {
      act(() => {
        outer.update(1);
      });
    }).not.toThrow();
  });
});
