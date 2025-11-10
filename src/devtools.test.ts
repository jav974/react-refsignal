/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { useRefSignal } from './hooks/useRefSignal';
import { configureDevTools, devtools } from './devtools';
import { createRefSignal } from './refsignal';

describe('DevTools', () => {
    beforeEach(() => {
        // Reset devtools config before each test
        configureDevTools({
            enabled: true,
            logUpdates: false,
            reduxDevTools: false,
            maxHistory: 100,
        });
        devtools.reset();
    });

    afterEach(() => {
        // Disable devtools after tests
        configureDevTools({ enabled: false });
        devtools.reset();
    });

    it('should be disabled by default in test environment', () => {
        configureDevTools({ enabled: false });
        expect(devtools.isEnabled()).toBe(false);
    });

    it('should enable devtools when configured', () => {
        configureDevTools({ enabled: true });
        expect(devtools.isEnabled()).toBe(true);
    });

    it('should register signal with auto-generated name', () => {
        const signal = createRefSignal(10);
        const name = devtools.getSignalName(signal);

        expect(name).toBeDefined();
        expect(name).toMatch(/^signal_\d+$/);
    });

    it('should register signal with custom name', () => {
        const signal = createRefSignal(10, 'myCounter');
        const name = devtools.getSignalName(signal);

        expect(name).toBe('myCounter');
    });

    it('should track signal updates in history', () => {
        const signal = createRefSignal(0, 'counter');

        signal.update(1);
        signal.update(2);

        const history = devtools.getUpdateHistory();

        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({
            signalId: 'counter',
            oldValue: 0,
            newValue: 1,
        });
        expect(history[1]).toMatchObject({
            signalId: 'counter',
            oldValue: 1,
            newValue: 2,
        });
    });

    it('should not track updates when disabled', () => {
        configureDevTools({ enabled: false });

        const signal = createRefSignal(0);
        signal.update(1);

        const history = devtools.getUpdateHistory();
        expect(history).toHaveLength(0);
    });

    it('should maintain max history size', () => {
        configureDevTools({ enabled: true, maxHistory: 3 });

        const signal = createRefSignal(0, 'counter');

        // Create 5 updates
        for (let i = 1; i <= 5; i++) {
            signal.update(i);
        }

        const history = devtools.getUpdateHistory();

        expect(history).toHaveLength(3);
        // Should keep the last 3 updates (3, 4, 5)
        expect(history[0].oldValue).toBe(2);
        expect(history[0].newValue).toBe(3);
        expect(history[2].oldValue).toBe(4);
        expect(history[2].newValue).toBe(5);
    });

    it('should clear history', () => {
        const signal = createRefSignal(0);
        signal.update(1);
        signal.update(2);

        expect(devtools.getUpdateHistory()).toHaveLength(2);

        devtools.clearHistory();

        expect(devtools.getUpdateHistory()).toHaveLength(0);
    });

    it('should get signal by name', () => {
        const signal1 = createRefSignal(10, 'counter');
        const signal2 = createRefSignal('hello', 'message');

        const foundCounter = devtools.getSignalByName('counter');
        const foundMessage = devtools.getSignalByName('message');

        expect(foundCounter).toBe(signal1);
        expect(foundMessage).toBe(signal2);
    });

    it('should get all signals', () => {
        createRefSignal(10, 'counter');
        createRefSignal('hello', 'message');

        const allSignals = devtools.getAllSignals();

        expect(allSignals).toHaveLength(2);
        expect(allSignals.map((s) => s.name)).toContain('counter');
        expect(allSignals.map((s) => s.name)).toContain('message');
    });

    it('should work with useRefSignal hook', () => {
        const { result } = renderHook(() => useRefSignal(0, 'hookCounter'));

        act(() => {
            result.current.update(5);
        });

        const history = devtools.getUpdateHistory();

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            signalId: 'hookCounter',
            oldValue: 0,
            newValue: 5,
        });
    });

    it('should have getDebugName method when enabled', () => {
        const signal = createRefSignal(0, 'test');

        expect(signal.getDebugName).toBeDefined();
        expect(signal.getDebugName?.()).toBe('test');
    });

    it('should not have getDebugName method when disabled', () => {
        configureDevTools({ enabled: false });
        const signal = createRefSignal(0, 'test');

        expect(signal.getDebugName).toBeUndefined();
    });

    it('should include timestamps in update history', () => {
        const signal = createRefSignal(0);
        const beforeUpdate = Date.now();

        signal.update(1);

        const afterUpdate = Date.now();
        const history = devtools.getUpdateHistory();

        expect(history[0].timestamp).toBeGreaterThanOrEqual(beforeUpdate);
        expect(history[0].timestamp).toBeLessThanOrEqual(afterUpdate);
    });

    it('should handle multiple signals independently', () => {
        const counter = createRefSignal(0, 'counter');
        const message = createRefSignal('', 'message');

        counter.update(1);
        message.update('hello');
        counter.update(2);

        const history = devtools.getUpdateHistory();

        expect(history).toHaveLength(3);
        expect(history[0].signalId).toBe('counter');
        expect(history[1].signalId).toBe('message');
        expect(history[2].signalId).toBe('counter');
    });
});
