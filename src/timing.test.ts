/**
 * @jest-environment jsdom
 */

import { createDebounce, createRAF, createThrottle } from './timing';

describe('createThrottle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls fn immediately on first invocation (leading)', () => {
    const fn = jest.fn();
    const { call } = createThrottle(fn, 100);

    call();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('suppresses calls within the window and fires trailing', () => {
    const fn = jest.fn();
    const { call } = createThrottle(fn, 100);

    call(); // leading
    call(); // within window — suppressed, trailing queued
    call(); // within window — suppressed, trailing timer replaced
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2); // trailing fires
  });

  it('cancels a pending trailing timer when a new leading call arrives', () => {
    // To hit this branch we need: elapsed >= ms AND timer !== null simultaneously.
    // Advancing fake timers fires the trailing callback before the next call, setting
    // timer=null. Mock Date.now so we can control elapsed without advancing timers.
    const fn = jest.fn();
    const { call } = createThrottle(fn, 100);

    // lastCall starts at 0; Date.now must return >= ms for the first call to be leading
    let now = 1000;
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    now = 1000;
    call(); // elapsed=1000-0=1000 >= 100 → leading, lastCall=1000
    expect(fn).toHaveBeenCalledTimes(1);

    now = 1050;
    call(); // elapsed=50 < 100 → trailing queued (timer !== null)
    expect(fn).toHaveBeenCalledTimes(1);

    now = 1200;
    call(); // elapsed=200 >= 100 → leading, timer still pending → lines 28-29 hit
    expect(fn).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(500); // no extra trailing fires
    expect(fn).toHaveBeenCalledTimes(2);

    dateSpy.mockRestore();
  });

  it('cancel() clears a pending trailing timer', () => {
    const fn = jest.fn();
    const { call, cancel } = createThrottle(fn, 100);

    call(); // leading
    call(); // trailing queued
    cancel();

    jest.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1); // only the leading call, trailing was canceled
  });

  it('cancel() is a no-op when no timer is pending', () => {
    const fn = jest.fn();
    const { cancel } = createThrottle(fn, 100);

    expect(() => {
      cancel();
    }).not.toThrow();
  });
});

describe('createDebounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires after the quiet period', () => {
    const fn = jest.fn();
    const { call } = createDebounce(fn, 100);

    call();
    call();
    call();
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on each call', () => {
    const fn = jest.fn();
    const { call } = createDebounce(fn, 100);

    call();
    jest.advanceTimersByTime(50);
    call(); // reset
    jest.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maxWait: flushes even if calls keep arriving', () => {
    const fn = jest.fn();
    const { call } = createDebounce(fn, 100, 250);

    for (let i = 0; i < 5; i++) {
      call();
      jest.advanceTimersByTime(50);
    }

    expect(fn).toHaveBeenCalledTimes(1); // maxWait fired at 250ms
  });

  it('cancel() clears both debounce and maxWait timers', () => {
    const fn = jest.fn();
    const { call, cancel } = createDebounce(fn, 100, 250);

    call(); // starts both timers
    cancel();

    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled(); // both timers were canceled
  });

  it('cancel() is a no-op when no timers are pending', () => {
    const fn = jest.fn();
    const { cancel } = createDebounce(fn, 100, 250);

    expect(() => {
      cancel();
    }).not.toThrow();
  });
});

describe('createRAF', () => {
  let rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    rafCallback = null;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('schedules fn on the next animation frame', () => {
    const fn = jest.fn();
    const { call } = createRAF(fn);

    call();
    expect(fn).not.toHaveBeenCalled();

    rafCallback?.(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('multiple calls within one frame collapse into one', () => {
    const fn = jest.fn();
    const { call } = createRAF(fn);

    call();
    call();
    call();

    rafCallback?.(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel() calls cancelAnimationFrame with the pending frame id', () => {
    const fn = jest.fn();
    const { call, cancel } = createRAF(fn);

    call();
    cancel();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() is a no-op when no frame is pending', () => {
    const fn = jest.fn();
    const { cancel } = createRAF(fn);

    expect(() => {
      cancel();
    }).not.toThrow();
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });

  it('allows scheduling again after a frame fires', () => {
    const fn = jest.fn();
    const { call } = createRAF(fn);

    call();
    rafCallback?.(0);
    expect(fn).toHaveBeenCalledTimes(1);

    call();
    rafCallback?.(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
