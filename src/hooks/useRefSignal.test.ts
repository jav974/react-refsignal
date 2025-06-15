/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { useRefSignal } from './useRefSignal';

describe('useRefSignal', () => {
    it('should initialize with value', () => {
        const { result } = renderHook(() => useRefSignal('test'));
        expect(result.current.current).toBe('test');
    });

    it('should update value when update is called', () => {
        const { result } = renderHook(() => useRefSignal('test'));
        act(() => {
            result.current.update('newtest');
        });
        expect(result.current.current).toBe('newtest');
    });

    it('should not trigger re-rendering when update is called', () => {
        let renderCount = 0;
        const { result } = renderHook(() => {
            renderCount++;
            return useRefSignal('test');
        });

        act(() => {
            result.current.update('newtest');
        });

        expect(renderCount).toBe(1); // Should only render once
    });

    it('should subscribe/get notified when value is updated', () => {
        const { result } = renderHook(() => useRefSignal('test'));

        act(() => {
            const listener = jest.fn();
            result.current.subscribe(listener);
            expect(listener).not.toHaveBeenCalled();
            result.current.update('newtest');
            expect(listener).toHaveBeenCalledWith('newtest');
        });
    });

    it('should not get notified after unsubscribe and value is updated', () => {
        const { result } = renderHook(() => useRefSignal('test'));

        act(() => {
            const listener = jest.fn();
            result.current.subscribe(listener);
            result.current.unsubscribe(listener);
            result.current.update('newtest');
            expect(listener).not.toHaveBeenCalled();
        });
    });
});
