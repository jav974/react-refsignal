/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';
import { useRefSignalRender } from './useRefSignalRender';
import { act } from 'react';
import { useRefSignalMemo } from './useRefSignalMemo';

describe('advanced', () => {
    it('should re-render when memo value updates', () => {
        let renderCount = 0;

        const { result } = renderHook(() => {
            renderCount++;
            const signalA = useRefSignal(1);
            const signalB = useRefSignal(1);
            const memo = useRefSignalMemo(
                () => signalA.ref.current + signalB.ref.current,
                [signalA, signalB],
            );
            useRefSignalRender([memo]);
            return { signalA, signalB, memo };
        });

        expect(renderCount).toBe(1);
        expect(result.current.memo.ref.current).toBe(2);

        act(() => {
            result.current.signalA.update(41);
        });

        expect(result.current.memo.ref.current).toBe(42);
        expect(renderCount).toBe(2);
    });
});
