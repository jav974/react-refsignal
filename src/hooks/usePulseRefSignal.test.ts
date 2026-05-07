/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { usePulseRefSignal } from './usePulseRefSignal';

describe('usePulseRefSignal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a stable signal across renders', () => {
    const { result, rerender } = renderHook(() => usePulseRefSignal(100));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('initializes with current = performance.now() and zero counters', () => {
    const before = performance.now();
    const { result } = renderHook(() => usePulseRefSignal(100));
    const after = performance.now();
    expect(result.current.current).toBeGreaterThanOrEqual(before);
    expect(result.current.current).toBeLessThanOrEqual(after);
    expect(result.current.tick).toBe(0);
    expect(result.current.dt).toBe(0);
    expect(result.current.elapsed).toBe(0);
  });

  it('drives subscribers on its cadence', () => {
    const { result } = renderHook(() => usePulseRefSignal(100));
    const listener = jest.fn();
    act(() => {
      result.current.subscribe(listener);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(result.current.tick).toBe(1);
  });

  it('disposes the signal on unmount — timer stops firing', () => {
    const { result, unmount } = renderHook(() => usePulseRefSignal(100));
    const listener = jest.fn();
    act(() => {
      result.current.subscribe(listener);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // No further fires after unmount.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('exposes updatePulse — rate can be changed dynamically post-mount', () => {
    const { result } = renderHook(() => usePulseRefSignal(100));
    const listener = jest.fn();
    act(() => {
      result.current.subscribe(listener);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(listener).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.updatePulse(500);
    });
    // Old 100ms cadence is gone.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    // New 500ms cadence fires.
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores rate changes after mount (mount-time option)', () => {
    const { result, rerender } = renderHook(
      ({ rate }: { rate: number }) => usePulseRefSignal(rate),
      { initialProps: { rate: 100 } },
    );
    const first = result.current;
    rerender({ rate: 500 });
    expect(result.current).toBe(first);

    const listener = jest.fn();
    act(() => {
      result.current.subscribe(listener);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    // Original 100ms cadence still in effect.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
