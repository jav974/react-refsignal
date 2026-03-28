/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
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
