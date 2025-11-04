/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';
import { useRefSignalMemo } from './useRefSignalMemo';

describe('useRefSignalMemo', () => {
    it('should initialize with value on initial mount', () => {
        const factory = jest.fn(() => 2);

        const { result } = renderHook(() => {
            const signal = useRefSignal(1);
            return useRefSignalMemo(factory, [signal]);
        });

        expect(factory).toHaveBeenCalledTimes(1); // Only called once during useMemo on mount
        expect(result.current.current).toBe(2);
    });

    it('should update value when signal value changes', () => {
        const factory = jest.fn(() => 2);

        const { result } = renderHook(() => {
            const signal = useRefSignal(1);
            useRefSignalMemo(factory, [signal]);
            return signal;
        });

        act(() => {
            result.current.update(2);
        });

        expect(factory).toHaveBeenCalledTimes(2); // 1 on mount, 1 when signal updates
    });
});
