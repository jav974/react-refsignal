import { createRefSignal, isUseRefSignalReturn, batch } from './refsignal';

describe('createRefSignal', () => {
    it('should create a RefSignal with initial value', () => {
        const signal = createRefSignal(42);
        expect(signal.current).toBe(42);
        expect(typeof signal.subscribe).toBe('function');
        expect(typeof signal.unsubscribe).toBe('function');
        expect(typeof signal.update).toBe('function');
        expect(typeof signal.notify).toBe('function');
        expect(typeof signal.notifyUpdate).toBe('function');
    });

    it('should satisfy isUseRefSignalReturn', () => {
        const signal = createRefSignal('test');
        expect(isUseRefSignalReturn(signal)).toBe(true);
    });

    it('should not satisfy isUseRefSignalReturn', () => {
        const signal = { current: 'test' };
        expect(isUseRefSignalReturn(signal)).toBe(false);
    });
});

describe('subscribe/unsubscribe/notify', () => {
    it('should call listener on notify', () => {
        const signal = createRefSignal('hello');
        const listener = jest.fn();
        signal.subscribe(listener);

        signal.notify();
        expect(listener).toHaveBeenCalledWith('hello');
    });

    it('should not call unsubscribed listener', () => {
        const signal = createRefSignal('bye');
        const listener = jest.fn();
        signal.subscribe(listener);
        signal.unsubscribe(listener);

        signal.notify();
        expect(listener).not.toHaveBeenCalled();
    });

    it('should call listeners on notify', () => {
        const signal = createRefSignal('hello');
        const listener = jest.fn();
        const listener2 = jest.fn();
        signal.subscribe(listener);
        signal.subscribe(listener2);

        signal.notify();
        expect(listener).toHaveBeenCalledWith('hello');
        expect(listener2).toHaveBeenCalledWith('hello');
    });
});

describe('notify/notifyUpdate', () => {
    it('should update lastUpdated timestamp when notifyUpdate is called', () => {
        const signal = createRefSignal(1);
        expect(signal.lastUpdated).toBe(0);

        signal.notifyUpdate();
        expect(signal.lastUpdated).not.toBe(0);
    });

    it('should not update lastUpdated timestamp when notify is called', () => {
        const signal = createRefSignal(1);
        expect(signal.lastUpdated).toBe(0);

        signal.notify();
        expect(signal.lastUpdated).toBe(0);
    });
});

describe('update', () => {
    it('should update value and notify listeners', () => {
        const signal = createRefSignal(1);
        const listener = jest.fn();
        signal.subscribe(listener);

        signal.update(2);
        expect(signal.current).toBe(2);
        expect(listener).toHaveBeenCalledWith(2);
    });

    it('should not notify if value is unchanged', () => {
        const signal = createRefSignal(5);
        const listener = jest.fn();
        signal.subscribe(listener);

        signal.update(5);
        expect(listener).not.toHaveBeenCalled();
    });

    it('should update lastUpdated property when updated', () => {
        const signal = createRefSignal(5);
        const currentTimestamp = signal.lastUpdated;

        expect(currentTimestamp).toBe(0);

        const listener = jest.fn();
        signal.subscribe(listener);

        signal.update(1);
        expect(signal.lastUpdated).not.toBe(currentTimestamp);
    });
});

describe('batch', () => {
    it('should defer notifications until after batch', () => {
        const signalA = createRefSignal(1);
        const signalB = createRefSignal(2);
        const listenerA = jest.fn();
        const listenerB = jest.fn();

        signalA.subscribe(listenerA);
        signalB.subscribe(listenerB);

        batch(() => {
            signalA.update(10);
            signalB.update(20);
            // Listeners should not be called yet
            expect(listenerA).not.toHaveBeenCalled();
            expect(listenerB).not.toHaveBeenCalled();
        }, [signalA, signalB]);

        // After batch, listeners should be called
        expect(listenerA).toHaveBeenCalledWith(10);
        expect(listenerB).toHaveBeenCalledWith(20);
    });
});
