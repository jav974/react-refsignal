/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';
import { useRefSignalRender } from './useRefSignalRender';
import { useRefSignalMemo } from './useRefSignalMemo';

describe('advanced', () => {
  it('should re-render when memo value updates', () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const signalA = useRefSignal(1);
      const signalB = useRefSignal(1);
      const memo = useRefSignalMemo(
        () => (signalA?.current ?? 0) + (signalB?.current ?? 0),
        [signalA, signalB],
      );
      useRefSignalRender([memo]);
      return { signalA, signalB, memo };
    });

    expect(renderCount).toBe(1);
    expect(result.current.memo.current).toBe(2);

    act(() => {
      result.current.signalA.update(41);
    });

    expect(result.current.memo.current).toBe(42);
    expect(renderCount).toBe(2);
  });
});
