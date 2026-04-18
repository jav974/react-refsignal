/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { useRefSignal } from './useRefSignal';
import { useRefSignalEffect } from './useRefSignalEffect';
import { useRefSignalRender } from './useRefSignalRender';
import { useRefSignalMemo } from './useRefSignalMemo';

describe('advanced', () => {
  it('useRefSignalEffect and useRefSignalRender can coexist in the same component independently', () => {
    // score drives re-renders; position drives a side effect — neither interferes with the other
    let renderCount = 0;
    let effectCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      const score = useRefSignal(0);
      const position = useRefSignal({ x: 0, y: 0 });

      useRefSignalRender([score]);
      useRefSignalEffect(() => {
        effectCount++;
      }, [position]);

      return { score, position };
    });

    // mount: effect runs once, one render
    expect(renderCount).toBe(1);
    expect(effectCount).toBe(1);

    // updating position fires the effect but does NOT re-render
    act(() => {
      result.current.position.update({ x: 10, y: 20 });
    });
    expect(effectCount).toBe(2);
    expect(renderCount).toBe(1);

    // updating score re-renders but does NOT fire the effect
    act(() => {
      result.current.score.update(1);
    });
    expect(renderCount).toBe(2);
    expect(effectCount).toBe(2);

    // both can update independently in the same tick
    act(() => {
      result.current.score.update(2);
      result.current.position.update({ x: 30, y: 40 });
    });
    expect(renderCount).toBe(3);
    expect(effectCount).toBe(3);
  });

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
