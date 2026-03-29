/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { createRefSignal } from '../refsignal';
import { useRefSignal } from './useRefSignal';
import { useRefSignalRender } from './useRefSignalRender';

describe('useRefSignalRender', () => {
  it('should not re-render on initial mount', () => {
    let renderCount = 0;

    renderHook(() => {
      renderCount++;
      const signal = useRefSignal(1);
      useRefSignalRender([signal]);
      return signal;
    });

    expect(renderCount).toBe(1);
  });

  it('should re-render when signal value changes', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(1);
      useRefSignalRender([signal]);
      return signal;
    });

    act(() => {
      result.current.update(2);
    });

    expect(renderCount).toBe(2);
  });

  it('should re-render only if callback returns true', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], () => signal.current >= 2);
      return signal;
    });

    act(() => {
      result.current.update(1);
    });

    expect(renderCount).toBe(1);

    act(() => {
      result.current.update(2);
    });

    expect(renderCount).toBe(2);
  });

  it('should re-render when calling the render function of useRefSignalRender manually', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      return useRefSignalRender([signal]);
    });

    expect(renderCount).toBe(1);

    act(() => {
      result.current();
    });

    expect(renderCount).toBe(2);
  });

  describe('notify() vs notifyUpdate()', () => {
    it('should not re-render when notify() is called — snapshot unchanged', () => {
      const signal = createRefSignal(0);
      let renderCount = 0;

      renderHook(() => {
        renderCount++;
        useRefSignalRender([signal]);
      });

      const initial = renderCount;
      act(() => {
        signal.notify();
      });

      // notify() does not bump lastUpdated — getSnapshot returns same value — no re-render
      expect(renderCount).toBe(initial);
    });

    it('should re-render when notifyUpdate() is called — snapshot changes', () => {
      const signal = createRefSignal(0);
      let renderCount = 0;

      renderHook(() => {
        renderCount++;
        useRefSignalRender([signal]);
      });

      const initial = renderCount;
      act(() => {
        signal.notifyUpdate();
      });

      expect(renderCount).toBeGreaterThan(initial);
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
    let renderCount = 0;

    const { result, rerender } = renderHook(
      ({ useSignalA }: { useSignalA: boolean }) => {
        renderCount++;
        const signalA = useRefSignal(0);
        const signalB = useRefSignal(0);

        // Dynamically switch which signal to listen to
        useRefSignalRender(useSignalA ? [signalA] : [signalB]);

        return { signalA, signalB };
      },
      { initialProps: { useSignalA: true } },
    );

    expect(renderCount).toBe(1);

    // Update signalA - should trigger re-render
    act(() => {
      result.current.signalA.update(1);
    });

    expect(renderCount).toBe(2);

    // Switch to listening to signalB instead
    rerender({ useSignalA: false });

    expect(renderCount).toBe(3);

    // Update signalA - should NOT trigger re-render anymore
    act(() => {
      result.current.signalA.update(2);
    });

    expect(renderCount).toBe(3); // No change

    // Update signalB - should NOW trigger re-render
    act(() => {
      result.current.signalB.update(1);
    });

    expect(renderCount).toBe(4);
  });
});

describe('useRefSignalRender — timing options', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('legacy callback API still works', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], () => signal.current >= 2);
      return signal;
    });

    act(() => {
      result.current.update(1);
    });
    expect(renderCount).toBe(1); // filter blocked

    act(() => {
      result.current.update(2);
    });
    expect(renderCount).toBe(2); // filter passed
  });

  it('throttle: rapid updates produce at most leading + one trailing render', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { throttle: 100 });
      return signal;
    });

    expect(renderCount).toBe(1);

    // First update fires immediately (leading)
    act(() => {
      result.current.update(1);
    });
    expect(renderCount).toBe(2);

    // Subsequent updates within the window are throttled
    act(() => {
      result.current.update(2);
    });
    act(() => {
      result.current.update(3);
    });
    act(() => {
      result.current.update(4);
    });
    expect(renderCount).toBe(2); // still throttled

    // Trailing call fires after the window
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renderCount).toBe(3);
  });

  it('throttle: updates after the window fire immediately again', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { throttle: 100 });
      return signal;
    });

    act(() => {
      result.current.update(1);
    }); // leading
    expect(renderCount).toBe(2);

    act(() => {
      jest.advanceTimersByTime(100);
    }); // window expires, no trailing needed
    act(() => {
      result.current.update(2);
    }); // leading again
    expect(renderCount).toBe(3);
  });

  it('debounce: rapid updates produce one render after quiet period', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { debounce: 100 });
      return signal;
    });

    act(() => {
      result.current.update(1);
    });
    act(() => {
      result.current.update(2);
    });
    act(() => {
      result.current.update(3);
    });
    expect(renderCount).toBe(1); // nothing yet

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renderCount).toBe(2); // one render after quiet
  });

  it('debounce: resets timer on each update', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { debounce: 100 });
      return signal;
    });

    act(() => {
      result.current.update(1);
    });
    act(() => {
      jest.advanceTimersByTime(50);
    }); // halfway
    act(() => {
      result.current.update(2);
    }); // reset timer
    act(() => {
      jest.advanceTimersByTime(50);
    }); // halfway again — should not fire yet
    expect(renderCount).toBe(1);

    act(() => {
      jest.advanceTimersByTime(50);
    }); // now 100ms since last update
    expect(renderCount).toBe(2);
  });

  it('debounce + maxWait: guarantees flush even if signal keeps firing', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { debounce: 100, maxWait: 250 });
      return signal;
    });

    // Keep firing every 50ms — debounce timer never settles
    for (let i = 1; i <= 5; i++) {
      act(() => {
        result.current.update(i);
      });
      act(() => {
        jest.advanceTimersByTime(50);
      });
    }

    // 250ms have passed — maxWait should have flushed once
    expect(renderCount).toBe(2);
  });

  it('rAF: update defers render to next animation frame', () => {
    let rafCallback: FrameRequestCallback | null = null;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { rAF: true });
      return signal;
    });

    act(() => {
      result.current.update(1);
    });
    expect(renderCount).toBe(1); // not rendered yet

    // Fire the rAF callback
    act(() => {
      rafCallback?.(0);
    });
    expect(renderCount).toBe(2);

    jest.restoreAllMocks();
  });

  it('rAF: multiple updates within one frame produce one render', () => {
    let rafCallback: FrameRequestCallback | null = null;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { rAF: true });
      return signal;
    });

    act(() => {
      result.current.update(1);
      result.current.update(2);
      result.current.update(3);
    });
    expect(renderCount).toBe(1);

    act(() => {
      rafCallback?.(0);
    });
    expect(renderCount).toBe(2); // exactly one render

    jest.restoreAllMocks();
  });

  it('forceUpdate bypasses timing options', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signal = useRefSignal(0);
      return useRefSignalRender([signal], { debounce: 1000 });
    });

    // forceUpdate fires immediately, no debounce
    act(() => {
      result.current();
    });
    expect(renderCount).toBe(2);
  });

  it('cleanup cancels pending timer on unmount', () => {
    const { result, unmount } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalRender([signal], { debounce: 100 });
      return signal;
    });

    act(() => {
      result.current.update(1);
    }); // starts debounce timer
    unmount(); // should cancel the timer

    // No error if timer would have fired after unmount
    act(() => {
      jest.advanceTimersByTime(200);
    });
  });
});
