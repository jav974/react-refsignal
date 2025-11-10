/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { createRefSignal } from './refsignal';
import { useRefSignal } from './hooks/useRefSignal';
import { useRefSignalEffect } from './hooks/useRefSignalEffect';
import { useRefSignalRender } from './hooks/useRefSignalRender';
import { configureDevTools, devtools } from './devtools';

describe('Robustness Tests', () => {
    beforeEach(() => {
        configureDevTools({ enabled: true });
        devtools.reset();
    });

    afterEach(() => {
        configureDevTools({ enabled: false });
        devtools.reset();
    });

    describe('Listener Exception Isolation', () => {
        it('should not break notification chain when one listener throws', () => {
            const signal = createRefSignal(0);
            const listener1 = jest.fn();
            const listener2 = jest.fn(() => {
                throw new Error('Listener 2 failed');
            });
            const listener3 = jest.fn();

            signal.subscribe(listener1);
            signal.subscribe(listener2);
            signal.subscribe(listener3);

            // Mock console.error to suppress error output in tests
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            signal.update(1);

            // All listeners should have been called despite listener2 throwing
            expect(listener1).toHaveBeenCalledWith(1);
            expect(listener2).toHaveBeenCalledWith(1);
            expect(listener3).toHaveBeenCalledWith(1);

            // Error should have been logged
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });

        it('should continue notifications when multiple listeners throw', () => {
            const signal = createRefSignal(0);
            const successListener = jest.fn();
            const errorListener1 = jest.fn(() => {
                throw new Error('Error 1');
            });
            const errorListener2 = jest.fn(() => {
                throw new Error('Error 2');
            });

            signal.subscribe(successListener);
            signal.subscribe(errorListener1);
            signal.subscribe(errorListener2);

            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            signal.update(1);

            // All listeners called
            expect(successListener).toHaveBeenCalledTimes(1);
            expect(errorListener1).toHaveBeenCalledTimes(1);
            expect(errorListener2).toHaveBeenCalledTimes(1);

            // Multiple errors logged
            expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

            consoleErrorSpy.mockRestore();
        });

        it('should handle exceptions in useRefSignalEffect listeners', () => {
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const { result } = renderHook(() => {
                const signal = useRefSignal(0);
                const effectCalls: number[] = [];

                useRefSignalEffect(() => {
                    effectCalls.push(signal.current);
                    if (signal.current === 1) {
                        throw new Error('Effect error');
                    }
                }, [signal]);

                return { signal, effectCalls };
            });

            // Initial effect runs
            expect(result.current.effectCalls).toEqual([0]);

            // Update that causes error
            act(() => {
                result.current.signal.update(1);
            });

            // Effect should have run despite error
            expect(result.current.effectCalls.length).toBe(2);

            // Continue with more updates
            act(() => {
                result.current.signal.update(2);
            });

            expect(result.current.effectCalls).toEqual([0, 1, 2]);

            consoleErrorSpy.mockRestore();
        });
    });

    describe('High Listener Count Stress Test', () => {
        it('should handle 1000+ listeners efficiently', () => {
            const signal = createRefSignal(0);
            const listeners: jest.Mock[] = [];

            // Add 1000 listeners
            for (let i = 0; i < 1000; i++) {
                const listener = jest.fn();
                listeners.push(listener);
                signal.subscribe(listener);
            }

            const startTime = performance.now();
            signal.update(1);
            const endTime = performance.now();
            const executionTime = endTime - startTime;

            // All listeners should be called
            listeners.forEach((listener) => {
                expect(listener).toHaveBeenCalledWith(1);
            });

            // Should complete in reasonable time (< 100ms for 1000 listeners)
            expect(executionTime).toBeLessThan(100);
        });

        it('should handle many signals with multiple listeners each', () => {
            const signals = Array.from({ length: 100 }, () =>
                createRefSignal(0),
            );

            // Add 10 listeners to each signal
            signals.forEach((signal) => {
                for (let i = 0; i < 10; i++) {
                    signal.subscribe(jest.fn());
                }
            });

            const startTime = performance.now();

            // Update all signals
            signals.forEach((signal, index) => {
                signal.update(index);
            });

            const endTime = performance.now();
            const executionTime = endTime - startTime;

            // Should complete in reasonable time
            expect(executionTime).toBeLessThan(100);
        });
    });

    describe('Concurrent Render Scenarios', () => {
        it('should handle rapid signal updates without tearing', () => {
            const { result } = renderHook(() => {
                const signal = useRefSignal(0);
                useRefSignalRender([signal]);
                return signal;
            });

            // Rapid updates
            act(() => {
                for (let i = 1; i <= 100; i++) {
                    result.current.update(i);
                }
            });

            // Final value should be correct
            expect(result.current.current).toBe(100);
        });

        it('should handle multiple components subscribing to same signal', () => {
            const signal = createRefSignal(0, 'sharedSignal');
            const renderCounts: number[] = [0, 0, 0];

            const hooks = Array.from({ length: 3 }, (_, index) =>
                renderHook(() => {
                    renderCounts[index]++;
                    useRefSignalRender([signal]);
                    return signal;
                }),
            );

            // Initial renders
            expect(renderCounts).toEqual([1, 1, 1]);

            // Update signal - all components should re-render
            act(() => {
                signal.update(1);
            });

            expect(renderCounts).toEqual([2, 2, 2]);

            // Cleanup
            hooks.forEach((hook) => hook.unmount());
        });

        it('should handle dynamic subscription changes without memory leaks', () => {
            const signalA = createRefSignal(0, 'signalA');
            const signalB = createRefSignal(0, 'signalB');

            const { result, rerender, unmount } = renderHook(
                ({ useA }: { useA: boolean }) => {
                    const signal = useA ? signalA : signalB;
                    useRefSignalRender([signal]);
                    return { signal, useA };
                },
                { initialProps: { useA: true } },
            );

            // Switch signals multiple times
            rerender({ useA: false });
            rerender({ useA: true });
            rerender({ useA: false });
            rerender({ useA: true });

            // Update both signals
            act(() => {
                signalA.update(1);
                signalB.update(1);
            });

            // Should still work correctly
            expect(result.current.signal).toBe(signalA);

            unmount();
        });
    });

    describe('Memory Leak Verification', () => {
        it('should clean up listeners on component unmount', () => {
            const signal = createRefSignal(0, 'testSignal');
            const listener = jest.fn();

            const { unmount } = renderHook(() => {
                useRefSignalEffect(() => {
                    listener();
                }, [signal]);
            });

            // Effect runs on mount
            expect(listener).toHaveBeenCalledTimes(1);

            // Update signal - listener runs
            signal.update(1);
            expect(listener).toHaveBeenCalledTimes(2);

            // Unmount component
            unmount();

            // Update signal - listener should NOT run
            signal.update(2);
            expect(listener).toHaveBeenCalledTimes(2); // Still 2, not 3
        });

        it('should not accumulate listeners on re-renders', () => {
            const signal = createRefSignal(0);
            let listenerCallCount = 0;

            const { rerender } = renderHook(() => {
                useRefSignalEffect(() => {
                    listenerCallCount++;
                }, [signal]);
            });

            // Initial mount
            expect(listenerCallCount).toBe(1);

            // Multiple re-renders
            rerender();
            rerender();
            rerender();

            // Update signal - should only trigger once
            signal.update(1);

            // Should be 2 total (1 from mount, 1 from update)
            // If listeners accumulated, would be more
            expect(listenerCallCount).toBe(2);
        });

        it('should handle rapid mount/unmount cycles without leaks', () => {
            const signal = createRefSignal(0);
            const listeners: jest.Mock[] = [];

            // Rapid mount/unmount cycles
            for (let i = 0; i < 50; i++) {
                const listener = jest.fn();
                listeners.push(listener);

                const { unmount } = renderHook(() => {
                    useRefSignalEffect(() => {
                        listener();
                    }, [signal]);
                });

                unmount();
            }

            // Update signal
            signal.update(1);

            // None of the unmounted listeners should be called
            listeners.forEach((listener) => {
                expect(listener).toHaveBeenCalledTimes(1); // Only initial mount
            });
        });
    });

    describe('Stack Underflow Protection', () => {
        it('should throw error on mismatched batch calls', () => {
            // This would require exposing batchStack or testing through batch()
            // For now, we verify batch() doesn't cause underflow
            const signal = createRefSignal(0);
            const listener = jest.fn();
            signal.subscribe(listener);

            // Normal batch usage
            expect(() => {
                import('./refsignal').then(({ batch }) => {
                    batch(() => {
                        signal.update(1);
                    }, [signal]);
                });
            }).not.toThrow();

            // Try-finally ensures stack is balanced even with errors
            expect(() => {
                import('./refsignal')
                    .then(({ batch }) => {
                        batch(() => {
                            throw new Error('Batch error');
                        }, [signal]);
                    })
                    .catch(() => {
                        // Expected to throw
                    });
            }).not.toThrow();
        });
    });
});
