/**
 * @jest-environment jsdom
 */

import { act, StrictMode } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { useRefSignal } from './useRefSignal';
import { useReplayRefSignal } from './useReplayRefSignal';

describe('useReplayRefSignal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Drive performance.now() from the fake-timer clock so due-time math
    // advances with jest.advanceTimersByTime.
    jest.spyOn(performance, 'now').mockImplementation(() => jest.now());
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mountReplay(ms = 100) {
    return renderHook(() => {
      const source = useRefSignal(0);
      const replayed = useReplayRefSignal(source, ms);
      return { source, replayed };
    });
  }

  it('starts at the source current value and follows it ms behind', () => {
    const { result } = mountReplay(100);

    expect(result.current.replayed.current).toBe(0);

    act(() => {
      result.current.source.update(1);
    });
    expect(result.current.replayed.current).toBe(0); // not due yet

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.replayed.current).toBe(1);
  });

  it('returns a stable signal across re-renders', () => {
    const { result, rerender } = mountReplay();

    const first = result.current.replayed;
    rerender();
    expect(result.current.replayed).toBe(first);
  });

  it('stops following the source on unmount', () => {
    const { result, unmount } = mountReplay(100);
    const { source, replayed } = result.current;

    act(() => {
      source.update(1);
    });
    unmount();

    expect(jest.getTimerCount()).toBe(0); // pending timer cleared

    act(() => {
      source.update(2);
      jest.advanceTimersByTime(500);
    });
    expect(replayed.current).toBe(0); // never emitted after unmount
  });

  it('applies the snapshot at enqueue time for in-place-mutated objects', () => {
    const { result } = renderHook(() => {
      const source = useRefSignal({ x: 0 });
      const replayed = useReplayRefSignal(source, 100, (p) => ({ ...p }));
      return { source, replayed };
    });

    act(() => {
      result.current.source.current.x = 1;
      result.current.source.notify(); // hot-path idiom: mutate + notify
      result.current.source.current.x = 2; // mutate again before due
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.replayed.current.x).toBe(1); // the past, not the present
    expect(result.current.replayed.current).not.toBe(
      result.current.source.current,
    );
  });

  it('keeps following the source across the StrictMode mount cycle', () => {
    const { result } = renderHook(
      () => {
        const source = useRefSignal(0);
        const replayed = useReplayRefSignal(source, 100);
        return { source, replayed };
      },
      { wrapper: StrictMode },
    );

    act(() => {
      result.current.source.update(1);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.replayed.current).toBe(1); // re-attached after the simulated remount
  });

  it('emits each replayed value exactly once under StrictMode (no double subscription)', () => {
    const seen: number[] = [];

    const { result } = renderHook(
      () => {
        const source = useRefSignal(0);
        const replayed = useReplayRefSignal(source, 100);
        return { source, replayed };
      },
      { wrapper: StrictMode },
    );

    result.current.replayed.subscribe((v) => seen.push(v));

    act(() => {
      result.current.source.update(1);
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(seen).toEqual([1]); // once, not twice
  });
});
