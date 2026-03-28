/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { createRefSignal } from '../refsignal';
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
});
