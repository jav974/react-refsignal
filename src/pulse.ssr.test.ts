/**
 * @jest-environment node
 *
 * Runs in pure Node where `typeof window === 'undefined'`, exercising the
 * SSR guard inside `createPulseRefSignal`. Construction must succeed (so the
 * signal can be hydrated on the client), but no timer should be installed.
 */

import { createPulseRefSignal } from './pulse';

describe('createPulseRefSignal SSR guard', () => {
  it('window is undefined in this environment (sanity)', () => {
    expect(typeof window).toBe('undefined');
  });

  it('constructs a usable signal without starting any timer', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    try {
      const s = createPulseRefSignal(100);
      expect(typeof s.current).toBe('number');
      expect(s.tick).toBe(0);
      expect(s.dt).toBe(0);
      expect(s.elapsed).toBe(0);

      const listener = jest.fn();
      s.subscribe(listener);
      // Even with a subscriber, no timer should have been installed.
      expect(setIntervalSpy).not.toHaveBeenCalled();
      // And the listener should never fire on its own.
      expect(listener).not.toHaveBeenCalled();

      s.unsubscribe(listener);
      expect(() => {
        s.dispose();
      }).not.toThrow();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('does not install a RAF loop for fps notation either', () => {
    const s = createPulseRefSignal('60fps');
    const listener = jest.fn();
    expect(() => {
      s.subscribe(listener);
    }).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    s.dispose();
  });
});
