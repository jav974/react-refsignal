/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
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
});
