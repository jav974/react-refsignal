/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
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
      const notASignal = useState<string>('test');
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
