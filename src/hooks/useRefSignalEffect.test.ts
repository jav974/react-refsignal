/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';
import { useRefSignalEffect } from './useRefSignalEffect';
import { useState } from 'react';

describe('useRefSignalEffect', () => {
  it('should run effect on initial mount', () => {
    const effect = jest.fn();

    renderHook(() => {
      const signal = useRefSignal(1);
      useRefSignalEffect(effect, [signal]);
      return signal;
    });

    expect(effect).toHaveBeenCalled();
  });

  it('should run effect when signal value changes', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(1);
      useRefSignalEffect(effect, [signal]);
      return signal;
    });

    act(() => {
      result.current.update(2);
    });

    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('should call destructor on unmount', () => {
    const destructor = jest.fn();

    const { unmount } = renderHook(() => {
      const signal = useRefSignal(1);
      useRefSignalEffect(() => {
        return destructor;
      }, [signal]);
    });

    // Destructor should not be called yet
    expect(destructor).not.toHaveBeenCalled();

    // Unmount the hook/component
    unmount();

    // Now destructor should have been called
    expect(destructor).toHaveBeenCalled();
  });

  it('should not trigger error when listening on non RefSignal object', () => {
    const listener = jest.fn();

    renderHook(() => {
      const notASignal = useState('test');
      useRefSignalEffect(listener, [notASignal]);
    });

    expect(listener).toHaveBeenCalled();
  });

  it('should prevent re-entrancy when effect updates its own dependency', () => {
    const effectCalls: number[] = [];

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(() => {
        effectCalls.push(signal.current);
        // This would cause infinite loop without re-entrancy protection
        if (signal.current < 3) {
          signal.update(signal.current + 1);
        }
      }, [signal]);
      return signal;
    });

    // Effect should run on mount with value 0, update to 1
    // The update to 1 triggers effect again, updates to 2
    // The update to 2 triggers effect again, updates to 3
    // The update to 3 triggers effect again, but condition is false
    expect(effectCalls).toEqual([0, 1, 2, 3]);
    expect(result.current.current).toBe(3);
  });

  it('should use latest effect function when signal updates', () => {
    const calls: string[] = [];

    const { result, rerender } = renderHook(
      ({ message }: { message: string }) => {
        const signal = useRefSignal(0);
        useRefSignalEffect(() => {
          calls.push(message);
        }, [signal]);
        return signal;
      },
      { initialProps: { message: 'first' } },
    );

    expect(calls).toEqual(['first']);

    // Change the effect function (via rerender)
    rerender({ message: 'second' });

    // Effect doesn't run because deps (signal) didn't change
    // But effectRef is updated with the new function
    expect(calls).toEqual(['first']);

    // When signal updates, should use the LATEST effect function from ref
    act(() => {
      result.current.update(1);
    });

    // Should use the latest effect function (captured 'message' is 'second')
    expect(calls).toEqual(['first', 'second']);
  });
});

describe('useRefSignalEffect — timing options', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('mount always runs synchronously regardless of timing options', () => {
    const effect = jest.fn();

    renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { debounce: 500 });
    });

    expect(effect).toHaveBeenCalledTimes(1); // immediate on mount
  });

  it('throttle: rapid signal fires run effect at most once per window', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { throttle: 100 });
      return signal;
    });

    expect(effect).toHaveBeenCalledTimes(1); // mount

    // First signal fire — leading call
    act(() => {
      result.current.update(1);
    });
    expect(effect).toHaveBeenCalledTimes(2);

    // More fires within the window — throttled
    act(() => {
      result.current.update(2);
    });
    act(() => {
      result.current.update(3);
    });
    expect(effect).toHaveBeenCalledTimes(2);

    // Trailing call after window
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(effect).toHaveBeenCalledTimes(3);
  });

  it('debounce: rapid signal fires produce one effect run after quiet period', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { debounce: 100 });
      return signal;
    });

    expect(effect).toHaveBeenCalledTimes(1); // mount

    act(() => {
      result.current.update(1);
    });
    act(() => {
      result.current.update(2);
    });
    act(() => {
      result.current.update(3);
    });
    expect(effect).toHaveBeenCalledTimes(1); // still only mount

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(effect).toHaveBeenCalledTimes(2); // one run after quiet
  });

  it('rAF: signal fires collapse into one effect run per frame', () => {
    let rafCallback: FrameRequestCallback | null = null;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { rAF: true });
      return signal;
    });

    expect(effect).toHaveBeenCalledTimes(1); // mount (synchronous)

    act(() => {
      result.current.update(1);
      result.current.update(2);
      result.current.update(3);
    });
    expect(effect).toHaveBeenCalledTimes(1); // not yet

    act(() => {
      rafCallback?.(0);
    });
    expect(effect).toHaveBeenCalledTimes(2); // exactly one run

    jest.restoreAllMocks();
  });

  it('conditional logic inside effect body works naturally with timing', () => {
    const calls: number[] = [];
    const threshold = 5;

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(
        () => {
          if (signal.current < threshold) return; // condition in effect body
          calls.push(signal.current);
        },
        [signal],
        { debounce: 100 },
      );
      return signal;
    });

    act(() => {
      result.current.update(3);
    }); // below threshold
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(calls).toHaveLength(0);

    act(() => {
      result.current.update(7);
    }); // above threshold
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(calls).toEqual([7]);
  });

  it('cleanup cancels pending timer on unmount', () => {
    const effect = jest.fn();

    const { result, unmount } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { debounce: 100 });
      return signal;
    });

    act(() => {
      result.current.update(1);
    }); // starts debounce timer
    unmount();

    act(() => {
      jest.advanceTimersByTime(200);
    }); // timer fires after unmount — effect should NOT run again
    expect(effect).toHaveBeenCalledTimes(1); // only the mount run
  });
});

describe('useRefSignalEffect — skipMount option', () => {
  it('does not run on mount when skipMount is true', () => {
    const effect = jest.fn();

    renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { skipMount: true });
    });

    expect(effect).not.toHaveBeenCalled();
  });

  it('runs on signal update when skipMount is true', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { skipMount: true });
      return signal;
    });

    act(() => {
      result.current.update(1);
    });

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('filter still applies to signal-triggered runs when skipMount is true', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], {
        skipMount: true,
        filter: () => signal.current > 5,
      });
      return signal;
    });

    act(() => {
      result.current.update(3);
    }); // filter false — skip
    expect(effect).not.toHaveBeenCalled();

    act(() => {
      result.current.update(10);
    }); // filter true — run
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe('useRefSignalEffect — filter option', () => {
  it('mount run is unconditional even when filter returns false', () => {
    const effect = jest.fn();

    renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { filter: () => false });
    });

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('skips effect when filter returns false on signal update', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], {
        filter: () => signal.current > 0,
      });
      return signal;
    });

    act(() => {
      result.current.update(0);
    }); // filter returns false — skip
    expect(effect).toHaveBeenCalledTimes(1); // only mount

    act(() => {
      result.current.update(1);
    }); // filter returns true — run
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('runs effect when filter returns true', () => {
    const effect = jest.fn();

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { filter: () => true });
      return signal;
    });

    act(() => {
      result.current.update(1);
    });
    expect(effect).toHaveBeenCalledTimes(2); // mount + signal update
  });

  it('picks up filter changes without resubscription', () => {
    const effect = jest.fn();
    let allow = false;

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], { filter: () => allow });
      return signal;
    });

    act(() => {
      result.current.update(1);
    }); // allow=false — skip
    expect(effect).toHaveBeenCalledTimes(1);

    allow = true;
    act(() => {
      result.current.update(2);
    }); // allow=true — run
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('composes with throttle — filter checked after throttle window', () => {
    jest.useFakeTimers();
    const effect = jest.fn();
    let allow = true;

    const { result } = renderHook(() => {
      const signal = useRefSignal(0);
      useRefSignalEffect(effect, [signal], {
        throttle: 100,
        filter: () => allow,
      });
      return signal;
    });

    act(() => {
      result.current.update(1);
    }); // leading edge fires, allow=true
    jest.advanceTimersByTime(50);
    allow = false;
    act(() => {
      result.current.update(2);
    });
    jest.advanceTimersByTime(100); // trailing edge fires, allow=false — skip

    expect(effect).toHaveBeenCalledTimes(2); // mount + leading edge only
    jest.useRealTimers();
  });
});
