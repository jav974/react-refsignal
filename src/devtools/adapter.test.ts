/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { useRefSignal } from '../hooks/useRefSignal';
import { configureDevTools, devtools } from './adapter';
import { createRefSignal } from '../refsignal';

describe('DevTools', () => {
  beforeEach(() => {
    configureDevTools({
      logUpdates: false,
      maxHistory: 100,
    });
    devtools.reset();
  });

  afterEach(() => {
    devtools.reset();
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

  it('should maintain max history size', () => {
    configureDevTools({ maxHistory: 3 });

    const signal = createRefSignal(0, 'counter');

    for (let i = 1; i <= 5; i++) {
      signal.update(i);
    }

    const history = devtools.getUpdateHistory();

    expect(history).toHaveLength(3);
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

  it('should get all signals (named and unnamed)', () => {
    const counter = createRefSignal(10, 'counter');
    const message = createRefSignal('hello', 'message');
    const anonymous = createRefSignal(0);

    const allSignals = devtools.getAllSignals();

    expect(allSignals).toHaveLength(3);
    const names = allSignals.map((s) => s.name);
    expect(names).toContain('counter');
    expect(names).toContain('message');
    expect(
      allSignals.find((s) => s.signal === anonymous)?.name,
    ).toBeUndefined();
    expect(allSignals.find((s) => s.signal === counter)?.id).toBe('counter');
    expect(allSignals.find((s) => s.signal === message)?.id).toBe('message');
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

  it('should return debug name from getDebugName when enabled', () => {
    const signal = createRefSignal(0, 'test');

    expect(signal.getDebugName()).toBe('test');
  });

  it('should log updates to console when logUpdates is enabled', () => {
    configureDevTools({ logUpdates: true });

    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => {});

    const signal = createRefSignal(10, 'testSignal');
    signal.update(20);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[RefSignal] testSignal updated:',
      { from: 10, to: 20 },
    );

    consoleLogSpy.mockRestore();
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

  it('uses "unknown" as signalId for signals not registered via registerSignal', () => {
    const unregistered = { current: 0 } as unknown as Parameters<
      typeof devtools.trackUpdate
    >[0];

    devtools.trackUpdate(unregistered, 0, 1);

    const history = devtools.getUpdateHistory();
    expect(history).toHaveLength(1);
    expect(history[0].signalId).toBe('unknown');
  });

  it('defaults maxHistory to 100 when not set in config', () => {
    configureDevTools({ maxHistory: undefined });

    const signal = createRefSignal(0);
    for (let i = 1; i <= 101; i++) {
      signal.update(i);
    }

    expect(devtools.getUpdateHistory()).toHaveLength(100);
  });

  it('clears named signal from devtools on dispose', () => {
    const signal = createRefSignal(0, 'disposed');
    expect(devtools.getSignalByName('disposed')).toBe(signal);

    signal.dispose();

    expect(devtools.getSignalByName('disposed')).toBeUndefined();
    expect(devtools.getSignalName(signal)).toBeUndefined();
  });

  it('clears unnamed signal tracking on dispose', () => {
    const signal = createRefSignal(0);
    expect(devtools.getSignalName(signal)).toMatch(/^signal_\d+$/);

    signal.dispose();

    expect(devtools.getSignalName(signal)).toBeUndefined();
  });

  it('dispose is idempotent for devtools cleanup', () => {
    const signal = createRefSignal(0, 'twice');
    signal.dispose();
    expect(() => {
      signal.dispose();
    }).not.toThrow();
    expect(devtools.getSignalByName('twice')).toBeUndefined();
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

  describe('event bus', () => {
    it('emits signal:register on createRefSignal and signal:dispose on dispose', () => {
      const signal = createRefSignal(0, 'busTest');
      const eventsAfterRegister = devtools.getEvents();
      expect(
        eventsAfterRegister.some(
          (e) =>
            e.kind === 'signal:register' &&
            (e as unknown as { id: string }).id === 'busTest',
        ),
      ).toBe(true);

      signal.dispose();
      const eventsAfterDispose = devtools.getEvents();
      expect(
        eventsAfterDispose.some(
          (e) =>
            e.kind === 'signal:dispose' &&
            (e as unknown as { id: string }).id === 'busTest',
        ),
      ).toBe(true);
    });

    it('emits signal:update events with old and new values', () => {
      const signal = createRefSignal(0, 'updEv');
      signal.update(42);

      const updateEvents = devtools.getEvents().filter(
        (
          e,
        ): e is typeof e & {
          id: string;
          oldValue: number;
          newValue: number;
        } =>
          e.kind === 'signal:update' &&
          (e as unknown as { id: string }).id === 'updEv',
      );
      expect(updateEvents).toHaveLength(1);
      expect(updateEvents[0].oldValue).toBe(0);
      expect(updateEvents[0].newValue).toBe(42);
    });

    it('caps the event ring buffer at maxEvents', () => {
      configureDevTools({ maxEvents: 5 });
      const signal = createRefSignal(0);
      for (let i = 1; i <= 10; i++) {
        signal.update(i);
      }
      expect(devtools.getEvents().length).toBeLessThanOrEqual(5);
    });

    it('bus signal increments on each emit (panels can subscribe)', () => {
      const before = devtools.bus.current;
      const signal = createRefSignal(0);
      signal.update(1);
      // Each createRefSignal emits register; each update emits update.
      // So bus increments at least twice between these checkpoints.
      expect(devtools.bus.current).toBeGreaterThan(before);
    });
  });

  describe('internal signals', () => {
    it('trackUpdate skips signals marked internal (no history, no event)', () => {
      const internal = createRefSignal(0);
      devtools.markInternal(internal);
      const historyBefore = devtools.getUpdateHistory().length;
      const eventsBefore = devtools.getEvents().length;
      internal.update(42);
      expect(devtools.getUpdateHistory().length).toBe(historyBefore);
      expect(devtools.getEvents().length).toBe(eventsBefore);
    });

    it('registerSignal returns a no-op cleanup for already-internal signals', () => {
      const internal = createRefSignal(0);
      devtools.markInternal(internal);
      // After markInternal it's no longer in the user-facing registry.
      expect(devtools.getAllSignals().some((s) => s.signal === internal)).toBe(
        false,
      );
      // Direct call: re-registering an already-internal signal returns a
      // callable no-op cleanup (covers the early-return closure).
      const cleanup = devtools.registerSignal(internal, 'tryAgain');
      expect(() => {
        cleanup();
      }).not.toThrow();
    });

    it('createInternal returns a usable signal that bypasses the registry', () => {
      const before = devtools.getAllSignals().length;
      const s = devtools.createInternal(0);
      expect(s.current).toBe(0);
      expect(devtools.getAllSignals().length).toBe(before);
      s.update(1);
      expect(s.current).toBe(1);
    });
  });

  describe('pulse routing', () => {
    it('routes pulse:tick to a per-pulse sample store (not the event ring)', () => {
      const fake = createRefSignal(0, 'fakePulse');
      const before = devtools.getEvents().length;
      devtools.emit({
        kind: 'pulse:tick',
        signal: fake,
        dt: 16.7,
        tickCount: 1,
        elapsed: 16.7,
        fps: 60,
        t: Date.now(),
      });
      expect(devtools.getEvents().length).toBe(before);
      const pulses = devtools.getPulseStates();
      const entry = pulses.find((p) => p.pulseId === 'fakePulse');
      expect(entry).toBeDefined();
      expect(entry?.tickCount).toBe(1);
      expect(entry?.recent).toHaveLength(1);
      expect(entry?.recent[0].fps).toBe(60);
    });

    it('keeps the per-pulse sample buffer bounded', () => {
      const fake = createRefSignal(0, 'cappedPulse');
      for (let i = 0; i < 80; i++) {
        devtools.emit({
          kind: 'pulse:tick',
          signal: fake,
          dt: 16.7,
          tickCount: i,
          elapsed: i * 16.7,
          fps: 60,
          t: Date.now(),
        });
      }
      const entry = devtools
        .getPulseStates()
        .find((p) => p.pulseId === 'cappedPulse');
      // adapter caps at 60 samples
      expect(entry?.recent.length).toBeLessThanOrEqual(60);
    });

    it('falls back to "pulse?" id when the event has no signal', () => {
      devtools.emit({
        kind: 'pulse:tick',
        dt: 16.7,
        tickCount: 1,
        elapsed: 16.7,
        fps: 60,
        t: Date.now(),
      });
      expect(
        devtools.getPulseStates().some((p) => p.pulseId === 'pulse?'),
      ).toBe(true);
    });
  });

  describe('broadcast channel routing', () => {
    it('routes broadcast:peers to a per-channel store (not the event ring)', () => {
      const before = devtools.getEvents().length;
      devtools.emit({
        kind: 'broadcast:peers',
        channel: 'chA',
        mode: 'one-to-many',
        heartbeatInterval: 300,
        heartbeatTimeout: 5000,
        gracePeriod: 0,
        isBroadcaster: true,
        isStable: true,
        count: 1,
        peers: [{ id: 'tab1', lastSeen: Date.now() }],
        t: Date.now(),
      });
      expect(devtools.getEvents().length).toBe(before);
      const channels = devtools.getBroadcastChannels();
      const ch = channels.find((c) => c.channel === 'chA');
      expect(ch).toBeDefined();
      expect(ch?.isBroadcaster).toBe(true);
      expect(ch?.peers).toHaveLength(1);
    });

    it('ignores broadcast:peers events with no channel', () => {
      const before = devtools.getBroadcastChannels().length;
      devtools.emit({
        kind: 'broadcast:peers',
        t: Date.now(),
      });
      expect(devtools.getBroadcastChannels().length).toBe(before);
    });

    it('subsequent broadcast:peers events update the same channel entry', () => {
      devtools.emit({
        kind: 'broadcast:peers',
        channel: 'chB',
        mode: 'one-to-many',
        isBroadcaster: false,
        isStable: false,
        count: 0,
        peers: [],
        t: Date.now(),
      });
      devtools.emit({
        kind: 'broadcast:peers',
        channel: 'chB',
        mode: 'one-to-many',
        isBroadcaster: true,
        isStable: true,
        count: 2,
        peers: [
          { id: 'a', lastSeen: Date.now() },
          { id: 'b', lastSeen: Date.now() },
        ],
        t: Date.now(),
      });
      const ch = devtools
        .getBroadcastChannels()
        .find((c) => c.channel === 'chB');
      expect(ch?.isBroadcaster).toBe(true);
      expect(ch?.peerCount).toBe(2);
    });
  });

  describe('trackNotify', () => {
    it('emits a throttled signal:touch event with the current value', () => {
      const s = createRefSignal({ x: 0 }, 'touchTest');
      s.current.x = 42;
      s.notify();
      const touches = devtools
        .getEvents()
        .filter((e) => e.kind === 'signal:touch');
      expect(
        touches.some((e) => (e as { id: string }).id === 'touchTest'),
      ).toBe(true);
    });

    it('throttles repeated notifies on the same signal to one event per window', () => {
      const s = createRefSignal({ x: 0 }, 'throttleTest');
      for (let i = 0; i < 5; i++) {
        s.current.x = i;
        s.notify();
      }
      const touches = devtools
        .getEvents()
        .filter(
          (e) =>
            e.kind === 'signal:touch' &&
            (e as { id: string }).id === 'throttleTest',
        );
      expect(touches.length).toBeLessThanOrEqual(1);
    });

    it('caps the touch event buffer (ring buffer shift)', () => {
      configureDevTools({ maxEvents: 3 });
      // Each new signal gets its own throttle window, so every notify
      // produces an event — quickly exceeding the cap and exercising
      // the buffer shift inside the touch-recording branch.
      for (let i = 0; i < 20; i++) {
        const s = createRefSignal({ v: i }, `bulk_${String(i)}`);
        s.current.v = i + 1;
        s.notify();
      }
      expect(devtools.getEvents().length).toBeLessThanOrEqual(3);
    });
  });
});
