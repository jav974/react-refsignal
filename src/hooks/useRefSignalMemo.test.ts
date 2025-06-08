/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';
import { useRefSignalMemo } from './useRefSignalMemo';
import { act } from 'react';

describe('useRefSignalMemo', () => {
    it('should initialize with value on initial mount', () => {
        const factory = jest.fn(() => 2);

        const { result } = renderHook(() => {
            const signal = useRefSignal(1);
            return useRefSignalMemo(factory, [signal]);
        });

        expect(factory).toHaveBeenCalledTimes(2); // 1 during hook instanciation, and 1 after useEffect()
        expect(result.current.ref.current).toBe(2);
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

        expect(factory).toHaveBeenCalledTimes(3); // 1 more time after dependant value update
    });
});
