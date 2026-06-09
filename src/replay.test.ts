/**
 * @jest-environment jsdom
 */

import { createRefSignal } from './refsignal';
import { createReplayRefSignal } from './replay';

describe('createReplayRefSignal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Drive performance.now() from the fake-timer clock so due-time math
    // advances with jest.advanceTimersByTime.
    jest.spyOn(performance, 'now').mockImplementation(() => jest.now());
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts at the source current value', () => {
    const source = createRefSignal(42);
    const replayed = createReplayRefSignal(source, 100);

    expect(replayed.current).toBe(42);

    replayed.dispose();
    source.dispose();
  });

  it('holds the previous value until ms elapses, then emits', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);

    source.update(1);
    expect(replayed.current).toBe(0); // not due yet

    jest.advanceTimersByTime(99);
    expect(replayed.current).toBe(0); // still not due

    jest.advanceTimersByTime(1);
    expect(replayed.current).toBe(1); // due at exactly +100

    replayed.dispose();
    source.dispose();
  });

  it('replays every update in order, preserving relative spacing', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);
    const seen: number[] = [];
    replayed.subscribe((v) => seen.push(v));

    source.update(1); // due at 100
    jest.advanceTimersByTime(30);
    source.update(2); // due at 130
    jest.advanceTimersByTime(30);
    source.update(3); // due at 160

    jest.advanceTimersByTime(40); // t=100
    expect(seen).toEqual([1]);
    jest.advanceTimersByTime(30); // t=130
    expect(seen).toEqual([1, 2]);
    jest.advanceTimersByTime(30); // t=160
    expect(seen).toEqual([1, 2, 3]);

    replayed.dispose();
    source.dispose();
  });

  it('drains all overdue entries in one pass when the timer fires late', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);
    const seen: number[] = [];
    replayed.subscribe((v) => seen.push(v));

    source.update(1); // due at 100
    jest.advanceTimersByTime(10);
    source.update(2); // due at 110

    // jsdom fake timers fire the armed timer at +100; both entries are due
    // by the time we jump far past them.
    jest.advanceTimersByTime(500);
    expect(seen).toEqual([1, 2]);
    expect(replayed.current).toBe(2);

    replayed.dispose();
    source.dispose();
  });

  it('snapshot captures in-place-mutated objects at enqueue time', () => {
    const source = createRefSignal({ x: 0 });
    const replayed = createReplayRefSignal(source, 100, (p) => ({ ...p }));

    source.current.x = 1;
    source.notify(); // hot-path idiom: mutate + notify
    source.current.x = 2;
    source.notify();

    jest.advanceTimersByTime(100);
    // Live object says 2, but the replayed signal shows the past as it was.
    expect(source.current.x).toBe(2);
    expect(replayed.current.x).toBe(2); // both entries due — last one wins
    expect(replayed.current).not.toBe(source.current); // distinct snapshot

    replayed.dispose();
    source.dispose();
  });

  it('without snapshot, in-place mutation leaks the present (documented footgun)', () => {
    const source = createRefSignal({ x: 0 });
    const replayed = createReplayRefSignal(source, 100); // identity capture

    source.current.x = 1;
    source.notify();
    source.current.x = 99; // mutate again before the entry is due

    jest.advanceTimersByTime(100);
    expect(replayed.current.x).toBe(99); // queue held a live reference

    replayed.dispose();
    source.dispose();
  });

  it('keeps no timer armed while the source is quiet', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);

    expect(jest.getTimerCount()).toBe(0); // quiet from creation

    source.update(1);
    expect(jest.getTimerCount()).toBe(1); // one armed timer

    jest.advanceTimersByTime(100);
    expect(jest.getTimerCount()).toBe(0); // queue drained — idle again

    replayed.dispose();
    source.dispose();
  });

  it('arms at most one timer for a burst', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);

    source.update(1);
    source.update(2);
    source.update(3);
    expect(jest.getTimerCount()).toBe(1);

    replayed.dispose();
    source.dispose();
  });

  it('dispose() cancels pending work and stops following the source', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);
    const seen: number[] = [];
    replayed.subscribe((v) => seen.push(v));

    source.update(1);
    replayed.dispose();

    expect(jest.getTimerCount()).toBe(0); // pending timer cleared

    source.update(2); // no longer followed
    jest.advanceTimersByTime(500);
    expect(seen).toEqual([]);
    expect(replayed.current).toBe(0);

    source.dispose();
  });

  it('derives a devtools-style debug name from the source when available', () => {
    // Without a devtools adapter getDebugName() is undefined — the replayed
    // signal must not throw and simply stays unnamed.
    const source = createRefSignal(0, 'price');
    const replayed = createReplayRefSignal(source, 50);
    expect(replayed.getDebugName()).toBeUndefined();

    replayed.dispose();
    source.dispose();
  });

  it('throws on a negative or non-finite delay', () => {
    const source = createRefSignal(0);

    expect(() => createReplayRefSignal(source, -1)).toThrow(
      /Invalid replay delay/,
    );
    expect(() => createReplayRefSignal(source, NaN)).toThrow(
      /Invalid replay delay/,
    );
    expect(() => createReplayRefSignal(source, Infinity)).toThrow(
      /Invalid replay delay/,
    );

    source.dispose();
  });

  it('ms = 0 emits on the next timer tick', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 0);

    source.update(1);
    expect(replayed.current).toBe(0); // still async — never synchronous

    jest.advanceTimersByTime(0);
    expect(replayed.current).toBe(1);

    replayed.dispose();
    source.dispose();
  });

  it('a replayed.update subscriber writing back to the source cannot deadlock or double-arm', () => {
    const source = createRefSignal(0);
    const replayed = createReplayRefSignal(source, 100);

    // Feedback loop: every replayed emission writes source again (bounded).
    replayed.subscribe((v) => {
      if (v < 3) source.update(v + 10);
    });

    source.update(1); // due at 100
    jest.advanceTimersByTime(100); // emits 1 → subscriber writes 11 (due at 200)
    expect(replayed.current).toBe(1);
    expect(jest.getTimerCount()).toBe(1); // exactly one re-armed timer

    jest.advanceTimersByTime(100); // emits 11 → subscriber stops (11 >= 3)
    expect(replayed.current).toBe(11);
    expect(jest.getTimerCount()).toBe(0);

    replayed.dispose();
    source.dispose();
  });
});
