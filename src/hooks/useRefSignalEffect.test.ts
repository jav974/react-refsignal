/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';
import { useRefSignalEffect } from './useRefSignalEffect';
import { act } from 'react';

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
});
