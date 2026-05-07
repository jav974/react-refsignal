/**
 * @jest-environment jsdom
 */

import { createPulseRefSignal } from './pulse';
import { setupRafMock } from './test-utils/raf';

describe('createPulseRefSignal', () => {
  describe('rate parsing', () => {
    it('accepts a positive number (interpreted as ms)', () => {
      const s = createPulseRefSignal(100);
      expect(typeof s.current).toBe('number');
      s.dispose();
    });

    it("accepts 'Nms' strings", () => {
      const s = createPulseRefSignal('250ms');
      expect(typeof s.current).toBe('number');
      s.dispose();
    });

    it("accepts 'Nfps' strings", () => {
      const s = createPulseRefSignal('60fps');
      expect(typeof s.current).toBe('number');
      s.dispose();
    });

    it("accepts 'raf'", () => {
      const s = createPulseRefSignal('raf');
      expect(typeof s.current).toBe('number');
      s.dispose();
    });

    it('accepts decimal ms and fps', () => {
      const a = createPulseRefSignal('16.67ms');
      const b = createPulseRefSignal('59.94fps');
      a.dispose();
      b.dispose();
    });

    it('rejects zero', () => {
      expect(() => createPulseRefSignal(0)).toThrow(/Invalid pulse rate/);
    });

    it('rejects negatives', () => {
      expect(() => createPulseRefSignal(-100)).toThrow(/Invalid pulse rate/);
    });

    it('rejects NaN', () => {
      expect(() => createPulseRefSignal(Number.NaN)).toThrow(
        /Invalid pulse rate/,
      );
    });

    it('rejects Infinity', () => {
      expect(() => createPulseRefSignal(Number.POSITIVE_INFINITY)).toThrow(
        /Invalid pulse rate/,
      );
    });

    it('rejects unitless / unknown-unit strings', () => {
      expect(() => createPulseRefSignal('60' as never)).toThrow(
        /Invalid pulse rate/,
      );
      expect(() => createPulseRefSignal('60s' as never)).toThrow(
        /Invalid pulse rate/,
      );
      expect(() => createPulseRefSignal('hello' as never)).toThrow(
        /Invalid pulse rate/,
      );
    });

    it("error message lists 'raf' as an accepted form", () => {
      expect(() => createPulseRefSignal('hello' as never)).toThrow(/'raf'/);
    });

    it("rejects '0fps' and '0ms'", () => {
      expect(() => createPulseRefSignal('0fps' as never)).toThrow(
        /fps must be positive/,
      );
      expect(() => createPulseRefSignal('0ms' as never)).toThrow(
        /ms must be positive/,
      );
    });
  });

  describe('initial state (no ticks yet)', () => {
    it('current is performance.now() at creation', () => {
      const before = performance.now();
      const s = createPulseRefSignal(100);
      const after = performance.now();
      expect(s.current).toBeGreaterThanOrEqual(before);
      expect(s.current).toBeLessThanOrEqual(after);
      s.dispose();
    });

    it('dt, tick, elapsed are all zero', () => {
      const s = createPulseRefSignal(100);
      expect(s.dt).toBe(0);
      expect(s.tick).toBe(0);
      expect(s.elapsed).toBe(0);
      s.dispose();
    });

    it('lastUpdated starts at 0', () => {
      const s = createPulseRefSignal(100);
      expect(s.lastUpdated).toBe(0);
      s.dispose();
    });
  });

  describe('lazy lifecycle (interval driver)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('does not fire while there are no subscribers', () => {
      const s = createPulseRefSignal(100);
      jest.advanceTimersByTime(1000);
      expect(s.tick).toBe(0);
      s.dispose();
    });

    it('starts firing after first subscriber', () => {
      const s = createPulseRefSignal(100);
      const listener = jest.fn();
      s.subscribe(listener);
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
      s.dispose();
    });

    it('uses one timer for many subscribers', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());
      s.subscribe(jest.fn());
      s.subscribe(jest.fn());
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      s.dispose();
      setIntervalSpy.mockRestore();
    });

    it('keeps firing while at least one subscriber remains', () => {
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      const b = jest.fn();
      s.subscribe(a);
      s.subscribe(b);
      s.unsubscribe(a);
      jest.advanceTimersByTime(100);
      expect(b).toHaveBeenCalledTimes(1);
      s.dispose();
    });

    it('stops firing when last subscriber leaves', () => {
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      s.subscribe(a);
      s.unsubscribe(a);
      jest.advanceTimersByTime(1000);
      expect(a).not.toHaveBeenCalled();
      s.dispose();
    });

    it('restarts the timer on a fresh subscriber after going idle', () => {
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      s.subscribe(a);
      s.unsubscribe(a);
      s.subscribe(a);
      jest.advanceTimersByTime(100);
      expect(a).toHaveBeenCalledTimes(1);
      s.dispose();
    });

    it('subscribing the same listener twice does not double-start', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const s = createPulseRefSignal(100);
      const listener = jest.fn();
      s.subscribe(listener);
      s.subscribe(listener); // duplicate — no transition
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      s.dispose();
      setIntervalSpy.mockRestore();
    });

    it('unsubscribing before any subscribe is a safe no-op', () => {
      const s = createPulseRefSignal(100);
      expect(() => {
        s.unsubscribe(jest.fn());
      }).not.toThrow();
      jest.advanceTimersByTime(1000);
      expect(s.tick).toBe(0);
      s.dispose();
    });

    it('unsubscribing an unknown listener does not stop the timer', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      const b = jest.fn();
      s.subscribe(a);
      s.unsubscribe(b); // not subscribed — no transition
      expect(clearIntervalSpy).not.toHaveBeenCalled();
      s.dispose();
      clearIntervalSpy.mockRestore();
    });

    it('dispose stops the timer', () => {
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      s.subscribe(a);
      s.dispose();
      jest.advanceTimersByTime(1000);
      expect(a).not.toHaveBeenCalled();
    });

    it('dispose is safe when no timer was ever started', () => {
      const s = createPulseRefSignal(100);
      expect(() => {
        s.dispose();
      }).not.toThrow();
    });

    it('dispose is idempotent', () => {
      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());
      s.dispose();
      expect(() => {
        s.dispose();
      }).not.toThrow();
    });
  });

  describe('tick semantics (interval driver)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('updates current and bumps lastUpdated each tick', () => {
      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());
      const u0 = s.lastUpdated;
      const c0 = s.current;
      jest.advanceTimersByTime(100);
      expect(s.lastUpdated).toBeGreaterThan(u0);
      expect(s.current).toBeGreaterThanOrEqual(c0);
      const u1 = s.lastUpdated;
      jest.advanceTimersByTime(100);
      expect(s.lastUpdated).toBeGreaterThan(u1);
      s.dispose();
    });

    it('tick counter increments by 1 per fire', () => {
      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());
      expect(s.tick).toBe(0);
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(1);
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(2);
      jest.advanceTimersByTime(300);
      expect(s.tick).toBe(5);
      s.dispose();
    });

    it('dt reflects time between ticks; elapsed accumulates from first tick', () => {
      let nowVal = 1000;
      const perfSpy = jest
        .spyOn(performance, 'now')
        .mockImplementation(() => nowVal);
      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());

      // First tick — dt = 100 (from start time 1000 to 1100), elapsed = 0
      nowVal = 1100;
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(1);
      expect(s.dt).toBe(100);
      expect(s.elapsed).toBe(0);

      // Second tick — dt = 150, elapsed = 150 (since first tick at 1100)
      nowVal = 1250;
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(2);
      expect(s.dt).toBe(150);
      expect(s.elapsed).toBe(150);

      // Third tick — dt = 50, elapsed = 200
      nowVal = 1300;
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(3);
      expect(s.dt).toBe(50);
      expect(s.elapsed).toBe(200);

      s.dispose();
      perfSpy.mockRestore();
    });

    it('fires every subscriber on each tick', () => {
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      const b = jest.fn();
      const c = jest.fn();
      s.subscribe(a);
      s.subscribe(b);
      s.subscribe(c);
      jest.advanceTimersByTime(100);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).toHaveBeenCalledTimes(1);
      s.dispose();
    });

    it('resets dt/tick/elapsed on a fresh subscribe session', () => {
      let nowVal = 1000;
      const perfSpy = jest
        .spyOn(performance, 'now')
        .mockImplementation(() => nowVal);
      const s = createPulseRefSignal(100);
      const a = jest.fn();
      s.subscribe(a);
      nowVal = 1100;
      jest.advanceTimersByTime(100);
      nowVal = 1200;
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(2);
      expect(s.elapsed).toBe(100);

      s.unsubscribe(a);
      nowVal = 5000; // long idle gap

      s.subscribe(a);
      // Re-subscribe resets the session
      expect(s.tick).toBe(0);
      expect(s.elapsed).toBe(0);
      expect(s.dt).toBe(0);

      // First tick of new session: dt is measured from the (re)start, not the idle gap
      nowVal = 5100;
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(1);
      expect(s.dt).toBe(100);
      s.dispose();
      perfSpy.mockRestore();
    });
  });

  describe('updatePulse', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('changes cadence on a running timer', () => {
      const s = createPulseRefSignal(100);
      const listener = jest.fn();
      s.subscribe(listener);
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);

      s.updatePulse(500);
      // The 100ms timer was cleared. Advancing 100ms should NOT fire.
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
      // After the new 500ms cadence elapses, it does.
      jest.advanceTimersByTime(400);
      expect(listener).toHaveBeenCalledTimes(2);
      s.dispose();
    });

    it('preserves tick and elapsed across rate changes', () => {
      let nowVal = 1000;
      const perfSpy = jest
        .spyOn(performance, 'now')
        .mockImplementation(() => nowVal);

      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());

      nowVal = 1100;
      jest.advanceTimersByTime(100);
      nowVal = 1200;
      jest.advanceTimersByTime(100);
      expect(s.tick).toBe(2);
      expect(s.elapsed).toBe(100);

      // Change rate — tick / elapsed should keep accumulating
      nowVal = 1250;
      s.updatePulse(500);
      expect(s.tick).toBe(2);
      expect(s.elapsed).toBe(100);

      // Next tick at 500ms after rate-change baseline (1250 → 1750)
      nowVal = 1750;
      jest.advanceTimersByTime(500);
      expect(s.tick).toBe(3);
      // dt is measured from the rate-change moment, not the previous tick
      expect(s.dt).toBe(500);
      // elapsed reflects time since first tick (1100), continuity preserved
      expect(s.elapsed).toBe(650);

      s.dispose();
      perfSpy.mockRestore();
    });

    it('only stores the new rate when no subscribers are attached', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const s = createPulseRefSignal(100);
      // No subscribers yet — updatePulse must not start a timer.
      s.updatePulse(500);
      expect(setIntervalSpy).not.toHaveBeenCalled();

      // First subscriber triggers start at the new (500ms) cadence.
      const listener = jest.fn();
      s.subscribe(listener);
      jest.advanceTimersByTime(100);
      expect(listener).not.toHaveBeenCalled();
      jest.advanceTimersByTime(400);
      expect(listener).toHaveBeenCalledTimes(1);

      s.dispose();
      setIntervalSpy.mockRestore();
    });

    it('throws on invalid rate without disturbing the running timer', () => {
      const s = createPulseRefSignal(100);
      const listener = jest.fn();
      s.subscribe(listener);

      expect(() => {
        s.updatePulse('nope' as never);
      }).toThrow(/Invalid pulse rate/);

      // Original 100ms cadence still active.
      jest.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
      s.dispose();
    });

    it('switches drivers when the format changes (interval → raf)', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const s = createPulseRefSignal(100);
      s.subscribe(jest.fn());
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      // Switching to fps notation should clear the interval and install RAF.
      // RAF isn't available in node-fake-timers; the SSR-style guard means
      // installTimer no-ops when window is undefined — which it isn't here
      // (jsdom env), but RAF in jsdom may be polyfilled. Rather than assert
      // on raf internals, assert the interval was torn down.
      s.updatePulse('60fps');
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

      s.dispose();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('survives dispose — re-subscribe after both updatePulse and dispose works at the new rate', () => {
      const s = createPulseRefSignal(100);
      const listener = jest.fn();
      s.subscribe(listener);
      s.updatePulse(500);
      s.dispose();

      // After dispose, subscribers were cleared but updatePulse-stored rate persists.
      // Re-subscribe spins a fresh session at 500ms.
      s.subscribe(listener);
      jest.advanceTimersByTime(100);
      expect(listener).not.toHaveBeenCalled();
      jest.advanceTimersByTime(400);
      expect(listener).toHaveBeenCalledTimes(1);
      s.dispose();
    });
  });

  describe('RAF driver (fps notation)', () => {
    let raf: ReturnType<typeof setupRafMock>;
    beforeEach(() => {
      raf = setupRafMock();
    });
    afterEach(() => {
      raf.restore();
    });

    it('routes fps notation through requestAnimationFrame', () => {
      const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame');
      const s = createPulseRefSignal('60fps');
      s.subscribe(jest.fn());
      expect(rafSpy).toHaveBeenCalled();
      s.dispose();
      rafSpy.mockRestore();
    });

    it('fires only once the interval has elapsed', () => {
      let nowVal = 0;
      const perfSpy = jest
        .spyOn(performance, 'now')
        .mockImplementation(() => nowVal);

      const s = createPulseRefSignal('60fps'); // ~16.67ms threshold
      const listener = jest.fn();
      nowVal = 100;
      s.subscribe(listener);

      // Frame at +10ms — under threshold (16.17), skip
      nowVal = 110;
      raf.fire();
      expect(listener).not.toHaveBeenCalled();
      expect(s.tick).toBe(0);

      // Frame at +17ms from last fire — over threshold, fire
      nowVal = 117;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(s.tick).toBe(1);

      // Frame at +17ms from previous fire — fire again
      nowVal = 134;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(s.tick).toBe(2);
      expect(s.dt).toBe(17);
      expect(s.elapsed).toBe(17);

      s.dispose();
      perfSpy.mockRestore();
    });

    it('cancels the RAF loop when last subscriber leaves', () => {
      const cafSpy = jest.spyOn(globalThis, 'cancelAnimationFrame');
      const s = createPulseRefSignal('60fps');
      const a = jest.fn();
      s.subscribe(a);
      expect(cafSpy).not.toHaveBeenCalled();
      s.unsubscribe(a);
      expect(cafSpy).toHaveBeenCalledTimes(1);
      s.dispose();
      cafSpy.mockRestore();
    });

    it('dispose cancels the RAF loop', () => {
      const cafSpy = jest.spyOn(globalThis, 'cancelAnimationFrame');
      const s = createPulseRefSignal('60fps');
      s.subscribe(jest.fn());
      s.dispose();
      expect(cafSpy).toHaveBeenCalledTimes(1);
      cafSpy.mockRestore();
    });
  });

  describe("'raf' driver — native-rate, no throttle", () => {
    let raf: ReturnType<typeof setupRafMock>;
    beforeEach(() => {
      raf = setupRafMock();
    });
    afterEach(() => {
      raf.restore();
    });

    it('routes through requestAnimationFrame', () => {
      const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame');
      const s = createPulseRefSignal('raf');
      s.subscribe(jest.fn());
      expect(rafSpy).toHaveBeenCalled();
      s.dispose();
      rafSpy.mockRestore();
    });

    it('fires on every frame regardless of inter-frame interval', () => {
      let nowVal = 0;
      const perfSpy = jest
        .spyOn(performance, 'now')
        .mockImplementation(() => nowVal);

      const s = createPulseRefSignal('raf');
      const listener = jest.fn();
      nowVal = 100;
      s.subscribe(listener);

      // Frame at +1ms — under any reasonable fps throttle, but 'raf' has none
      nowVal = 101;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(s.tick).toBe(1);

      // Frame at +1ms again — still fires
      nowVal = 102;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(s.tick).toBe(2);

      // Frame at +8ms — would be skipped at '60fps' (~16.67 threshold), still fires
      nowVal = 110;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(3);
      expect(s.tick).toBe(3);
      expect(s.dt).toBe(8);
      expect(s.elapsed).toBe(9);

      s.dispose();
      perfSpy.mockRestore();
    });

    it("updatePulse('60fps' → 'raf') drops the throttle", () => {
      let nowVal = 0;
      const perfSpy = jest
        .spyOn(performance, 'now')
        .mockImplementation(() => nowVal);

      const s = createPulseRefSignal('60fps');
      const listener = jest.fn();
      nowVal = 0;
      s.subscribe(listener);

      // 60fps: a 5ms frame is below threshold and skipped
      nowVal = 5;
      raf.fire();
      expect(listener).not.toHaveBeenCalled();

      // Switch to 'raf' — the throttle gate disappears
      s.updatePulse('raf');

      nowVal = 6;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(1);
      nowVal = 7;
      raf.fire();
      expect(listener).toHaveBeenCalledTimes(2);

      s.dispose();
      perfSpy.mockRestore();
    });

    it('cancels the RAF loop on dispose', () => {
      const cafSpy = jest.spyOn(globalThis, 'cancelAnimationFrame');
      const s = createPulseRefSignal('raf');
      s.subscribe(jest.fn());
      s.dispose();
      expect(cafSpy).toHaveBeenCalledTimes(1);
      cafSpy.mockRestore();
    });
  });

  describe('RAF driver fallback when requestAnimationFrame is missing', () => {
    it('returns a no-op stop and does not throw', () => {
      const g = globalThis as unknown as {
        requestAnimationFrame?: typeof requestAnimationFrame;
        cancelAnimationFrame?: typeof cancelAnimationFrame;
      };
      const savedRaf = g.requestAnimationFrame;
      const savedCaf = g.cancelAnimationFrame;
      delete g.requestAnimationFrame;
      delete g.cancelAnimationFrame;
      try {
        const s = createPulseRefSignal('60fps');
        const listener = jest.fn();
        expect(() => {
          s.subscribe(listener);
        }).not.toThrow();
        // Without RAF the loop never schedules, so the listener stays silent.
        expect(listener).not.toHaveBeenCalled();
        expect(() => {
          s.unsubscribe(listener);
        }).not.toThrow();
        expect(() => {
          s.dispose();
        }).not.toThrow();
      } finally {
        g.requestAnimationFrame = savedRaf;
        g.cancelAnimationFrame = savedCaf;
      }
    });
  });
});
