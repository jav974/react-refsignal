/**
 * @jest-environment jsdom
 */

import { createRefSignal, batch } from './refsignal';

describe('batch() - Auto-inference', () => {
    it('should auto-infer signals updated via .update()', () => {
        const signalA = createRefSignal(0);
        const signalB = createRefSignal(0);
        const listenerA = jest.fn();
        const listenerB = jest.fn();

        signalA.subscribe(listenerA);
        signalB.subscribe(listenerB);

        // Batch without explicit deps
        batch(() => {
            signalA.update(1);
            signalB.update(2);
        });

        // Both listeners should be called exactly once (after batch)
        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerB).toHaveBeenCalledTimes(1);
        expect(listenerA).toHaveBeenCalledWith(1);
        expect(listenerB).toHaveBeenCalledWith(2);
    });

    it('should not notify during batch execution', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        batch(() => {
            signal.update(1);
            expect(listener).not.toHaveBeenCalled(); // Not called yet
            signal.update(2);
            expect(listener).not.toHaveBeenCalled(); // Still not called
        });

        // Called once after batch
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(2);
    });

    it('should handle empty batch (no updates)', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        // Batch with no updates
        batch(() => {
            // Nothing
        });

        expect(listener).not.toHaveBeenCalled();
    });

    it('should only track signals that actually changed', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        batch(() => {
            signal.update(0); // Same value - shouldn't trigger
        });

        expect(listener).not.toHaveBeenCalled();
    });

    it('should track multiple updates to same signal', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        batch(() => {
            signal.update(1);
            signal.update(2);
            signal.update(3);
        });

        // Called once with final value
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(3);
    });

    it('should handle errors in batch callback', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        expect(() => {
            batch(() => {
                signal.update(1);
                throw new Error('Batch error');
            });
        }).toThrow('Batch error');

        // Listener should still be notified despite error
        expect(listener).toHaveBeenCalledWith(1);
    });
});

describe('batch() - Explicit Deps (Backward Compatibility)', () => {
    it('should work with explicit deps array', () => {
        const signalA = createRefSignal(0);
        const signalB = createRefSignal(0);
        const listenerA = jest.fn();
        const listenerB = jest.fn();

        signalA.subscribe(listenerA);
        signalB.subscribe(listenerB);

        // Explicit deps - original API
        batch(() => {
            signalA.update(1);
            signalB.update(2);
        }, [signalA, signalB]);

        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it('should batch direct mutations with explicit deps', () => {
        const signalA = createRefSignal(0);
        const signalB = createRefSignal(0);
        const listenerA = jest.fn();
        const listenerB = jest.fn();

        signalA.subscribe(listenerA);
        signalB.subscribe(listenerB);

        // Direct mutations require explicit deps
        batch(() => {
            signalA.current = 1;
            signalB.current = 2;
        }, [signalA, signalB]);

        // Both notified
        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it('should batch manual .notify() calls with explicit deps', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        batch(() => {
            signal.current = 1;
            signal.notify(); // Manual notification
        }, [signal]);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should work with empty deps array', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        batch(() => {
            signal.update(1);
        }, []); // Empty deps - won't batch anything

        // Listener called immediately (not batched)
        expect(listener).toHaveBeenCalled();
    });
});

describe('batch() - Nested Batches', () => {
    it('should handle nested auto-inferred batches', () => {
        const signalA = createRefSignal(0);
        const signalB = createRefSignal(0);
        const listenerA = jest.fn();
        const listenerB = jest.fn();

        signalA.subscribe(listenerA);
        signalB.subscribe(listenerB);

        batch(() => {
            signalA.update(1);

            batch(() => {
                signalB.update(2);
            });

            signalA.update(3);
        });

        // Both notified once with final values
        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerA).toHaveBeenCalledWith(3);
        expect(listenerB).toHaveBeenCalledTimes(1);
        expect(listenerB).toHaveBeenCalledWith(2);
    });

    it('should handle mixed nested batches (auto + explicit)', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        // Outer: auto-inferred
        batch(() => {
            signal.update(1);

            // Inner: explicit deps
            batch(() => {
                signal.current = 2;
            }, [signal]);
        });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(2);
    });

    it('should restore previous batch context after nested batch', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        let innerBatchComplete = false;

        batch(() => {
            signal.update(1);

            batch(() => {
                signal.update(2);
            });

            innerBatchComplete = true;
            signal.update(3);
        });

        expect(innerBatchComplete).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(3);
    });
});

describe('batch() - Edge Cases', () => {
    it('should handle signals updated both inside and outside batch', () => {
        const signal = createRefSignal(0);
        const listener = jest.fn();
        signal.subscribe(listener);

        signal.update(1); // Outside batch
        expect(listener).toHaveBeenCalledTimes(1);

        batch(() => {
            signal.update(2); // Inside batch
        });

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith(2);
    });

    it('should sync lastUpdated timestamps for batched signals', () => {
        const signalA = createRefSignal(0);
        const signalB = createRefSignal(0);

        batch(() => {
            signalA.update(1);
            signalB.update(2);
        });

        // Should have same timestamp
        expect(signalA.lastUpdated).toBe(signalB.lastUpdated);
    });

    it('should handle conditional updates in batch', () => {
        const signalA = createRefSignal(0);
        const signalB = createRefSignal(0);
        const listenerA = jest.fn();
        const listenerB = jest.fn();

        signalA.subscribe(listenerA);
        signalB.subscribe(listenerB);

        batch(() => {
            if (Math.random() > -1) {
                signalA.update(1);
            }
            // signalB not updated
        });

        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerB).not.toHaveBeenCalled();
    });

    it('should work with signals in different scopes', () => {
        const outerSignal = createRefSignal(0);
        const listener = jest.fn();
        outerSignal.subscribe(listener);

        function updateInner() {
            const innerSignal = createRefSignal(10);
            return innerSignal;
        }

        batch(() => {
            outerSignal.update(1);
            const inner = updateInner();
            inner.update(20);
        });

        expect(listener).toHaveBeenCalledWith(1);
    });
});

describe('batch() - Performance', () => {
    it('should batch 100 signal updates efficiently', () => {
        const signals = Array.from({ length: 100 }, () => createRefSignal(-1));
        const listeners = signals.map(() => jest.fn());

        signals.forEach((signal, i) => {
            signal.subscribe(listeners[i]);
        });

        const start = performance.now();

        batch(() => {
            signals.forEach((signal, i) => {
                signal.update(i);
            });
        });

        const duration = performance.now() - start;

        // Should complete quickly
        expect(duration).toBeLessThan(100);

        // All notified exactly once
        listeners.forEach((listener) => {
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });
});
