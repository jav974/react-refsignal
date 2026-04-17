/**
 * @jest-environment jsdom
 */

import { createRefSignal, RefSignal } from './refsignal';
import { createSubscription } from './subscription';

describe('createSubscription', () => {
  // ─── Static subscriptions ────────────────────────────────────────────────

  it('fires onFire when a static RefSignal in deps updates', () => {
    const onFire = jest.fn();
    const signal = createRefSignal(0);

    const sub = createSubscription({ deps: [signal], onFire });
    signal.update(1);

    expect(onFire).toHaveBeenCalledTimes(1);
    sub.dispose();
  });

  it('ignores non-RefSignal values in deps without error', () => {
    const onFire = jest.fn();
    const signal = createRefSignal(0);

    const sub = createSubscription({
      deps: [signal, 'not a signal', 42, null, undefined, {}],
      onFire,
    });
    signal.update(1);

    expect(onFire).toHaveBeenCalledTimes(1);
    sub.dispose();
  });

  it('does not call onFire at setup time', () => {
    const onFire = jest.fn();
    const signal = createRefSignal(0);

    const sub = createSubscription({ deps: [signal], onFire });

    expect(onFire).not.toHaveBeenCalled();
    sub.dispose();
  });

  // ─── Dynamic subscriptions ───────────────────────────────────────────────

  it('fires onFire when a dynamically-tracked signal updates', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');

    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals: () => [inner] },
    });

    inner.update('b');

    expect(onFire).toHaveBeenCalledTimes(1);
    sub.dispose();
  });

  it('re-resolves trackSignals on static fire and swaps dynamic subscription', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const innerA = createRefSignal('a');
    const innerB = createRefSignal('b');
    let active = innerA;

    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals: () => [active] },
    });

    // Initially subscribed to innerA
    innerA.update('a2');
    expect(onFire).toHaveBeenCalledTimes(1);

    // Swap the active inner; fire outer so reconcile picks up the swap
    active = innerB;
    outer.update(1); // static fire → reconcile
    // Static fire ALSO triggers onFire
    expect(onFire).toHaveBeenCalledTimes(2);

    // innerA should no longer trigger onFire
    innerA.update('a3');
    expect(onFire).toHaveBeenCalledTimes(2);

    // innerB should now trigger onFire
    innerB.update('b2');
    expect(onFire).toHaveBeenCalledTimes(3);

    sub.dispose();
  });

  it('does NOT re-run trackSignals on dynamic fires', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');

    const trackSignals = jest.fn(() => [inner]);
    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals },
    });

    // Called once at setup
    expect(trackSignals).toHaveBeenCalledTimes(1);

    // Dynamic fires — must NOT re-run trackSignals
    inner.update('b');
    inner.update('c');
    inner.update('d');
    expect(trackSignals).toHaveBeenCalledTimes(1);

    // Static fire — MUST re-run trackSignals
    outer.update(1);
    expect(trackSignals).toHaveBeenCalledTimes(2);

    sub.dispose();
  });

  // ─── Reconcile shortcuts ─────────────────────────────────────────────────

  it('ref-equal shortcut — same array ref skips diff', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');
    const sub_spy = jest.spyOn(inner, 'subscribe');
    const unsub_spy = jest.spyOn(inner, 'unsubscribe');

    const cached = [inner];
    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals: () => cached },
    });

    // Initial subscribe happened
    const subCallsAfterSetup = sub_spy.mock.calls.length;

    // Trigger three reconciles via static fires
    outer.update(1);
    outer.update(2);
    outer.update(3);

    // Ref-equal hit each time — no additional sub/unsub calls on inner
    expect(sub_spy).toHaveBeenCalledTimes(subCallsAfterSetup);
    expect(unsub_spy).not.toHaveBeenCalled();

    sub.dispose();
  });

  it('content-equal shortcut — same elements, fresh array, skips diff', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');
    const sub_spy = jest.spyOn(inner, 'subscribe');
    const unsub_spy = jest.spyOn(inner, 'unsubscribe');

    const sub = createSubscription({
      deps: [outer],
      onFire,
      // New array each call, same contents
      options: { trackSignals: () => [inner] },
    });

    const subCallsAfterSetup = sub_spy.mock.calls.length;

    outer.update(1);
    outer.update(2);

    // Content-equal hit each time — no additional sub/unsub on inner
    expect(sub_spy).toHaveBeenCalledTimes(subCallsAfterSetup);
    expect(unsub_spy).not.toHaveBeenCalled();

    sub.dispose();
  });

  it('full diff when content differs — unsubs removed, subs added', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const a = createRefSignal('a');
    const b = createRefSignal('b');
    const c = createRefSignal('c');

    const aUnsub = jest.spyOn(a, 'unsubscribe');
    const bUnsub = jest.spyOn(b, 'unsubscribe');
    const cSub = jest.spyOn(c, 'subscribe');

    let set: RefSignal<string>[] = [a, b];
    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals: () => set },
    });

    // Change set: drop `a`, keep `b`, add `c`
    set = [b, c];
    outer.update(1);

    expect(aUnsub).toHaveBeenCalledTimes(1);
    expect(bUnsub).not.toHaveBeenCalled();
    expect(cSub).toHaveBeenCalledTimes(1);

    sub.dispose();
  });

  // ─── Filter semantics ────────────────────────────────────────────────────

  it('filter=false skips onFire but still runs reconcile', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const innerA = createRefSignal('a');
    const innerB = createRefSignal('b');
    let active = innerA;

    const trackSignals = jest.fn(() => [active]);
    const aUnsub = jest.spyOn(innerA, 'unsubscribe');
    const bSub = jest.spyOn(innerB, 'subscribe');

    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals, filter: () => false },
    });

    // Swap active + static fire
    active = innerB;
    outer.update(1);

    // Reconcile ran: trackSignals re-called, a unsubbed, b subbed
    expect(trackSignals).toHaveBeenCalledTimes(2);
    expect(aUnsub).toHaveBeenCalledTimes(1);
    expect(bSub).toHaveBeenCalledTimes(1);
    // But onFire was filtered out
    expect(onFire).not.toHaveBeenCalled();

    sub.dispose();
  });

  it('filter gates onFire on both static and dynamic fires', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');
    let allow = false;

    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: {
        trackSignals: () => [inner],
        filter: () => allow,
      },
    });

    outer.update(1);
    inner.update('b');
    expect(onFire).not.toHaveBeenCalled();

    allow = true;
    outer.update(2);
    inner.update('c');
    expect(onFire).toHaveBeenCalledTimes(2);

    sub.dispose();
  });

  // ─── Dispose ─────────────────────────────────────────────────────────────

  it('dispose unsubscribes all static and dynamic signals', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');

    const outerUnsub = jest.spyOn(outer, 'unsubscribe');
    const innerUnsub = jest.spyOn(inner, 'unsubscribe');

    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals: () => [inner] },
    });

    sub.dispose();

    expect(outerUnsub).toHaveBeenCalledTimes(1);
    expect(innerUnsub).toHaveBeenCalledTimes(1);

    // Fires after dispose must not reach onFire
    outer.update(1);
    inner.update('b');
    expect(onFire).not.toHaveBeenCalled();
  });

  it('dispose is idempotent', () => {
    const onFire = jest.fn();
    const outer = createRefSignal(0);
    const inner = createRefSignal('a');

    const outerUnsub = jest.spyOn(outer, 'unsubscribe');
    const innerUnsub = jest.spyOn(inner, 'unsubscribe');

    const sub = createSubscription({
      deps: [outer],
      onFire,
      options: { trackSignals: () => [inner] },
    });

    sub.dispose();
    sub.dispose();
    sub.dispose();

    expect(outerUnsub).toHaveBeenCalledTimes(1);
    expect(innerUnsub).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels pending timing-wrapped flushes', () => {
    jest.useFakeTimers();
    try {
      const onFire = jest.fn();
      const signal = createRefSignal(0);

      const sub = createSubscription({
        deps: [signal],
        onFire,
        options: { throttle: 100 },
      });

      signal.update(1); // leading fires
      expect(onFire).toHaveBeenCalledTimes(1);

      signal.update(2); // trailing queued
      sub.dispose();

      jest.advanceTimersByTime(500);
      // Trailing was cancelled — still just the leading call
      expect(onFire).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // ─── Timing + coalescing ─────────────────────────────────────────────────

  it('throttle coalesces static + dynamic fires into one flush', () => {
    jest.useFakeTimers();
    try {
      const onFire = jest.fn();
      const outer = createRefSignal(0);
      const inner = createRefSignal('a');
      const trackSignals = jest.fn(() => [inner]);

      const sub = createSubscription({
        deps: [outer],
        onFire,
        options: { throttle: 100, trackSignals },
      });

      // Burst of mixed fires within the throttle window
      outer.update(1); // static — leading fires flush, sets flag, reconciles
      inner.update('b'); // dynamic — trailing queued
      outer.update(2); // static — sets flag for trailing
      inner.update('c'); // dynamic — trailing replaced

      // Leading onFire has fired
      expect(onFire).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);

      // Trailing flush runs — second onFire, reconcile happened via flag
      expect(onFire).toHaveBeenCalledTimes(2);

      // trackSignals called: setup + leading flush + trailing flush = 3
      expect(trackSignals).toHaveBeenCalledTimes(3);

      sub.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  // ─── Re-entrancy ─────────────────────────────────────────────────────────

  it('allows onFire to update a static-dep signal (re-entrancy)', () => {
    const calls: number[] = [];
    const signal = createRefSignal(0);

    const sub = createSubscription({
      deps: [signal],
      onFire: () => {
        calls.push(signal.current);
        if (signal.current < 3) signal.update(signal.current + 1);
      },
    });

    signal.update(1);

    // Cascade: 1 → onFire(1) → update(2) → onFire(2) → update(3) → onFire(3)
    expect(calls).toEqual([1, 2, 3]);

    sub.dispose();
  });

  it('allows onFire to update a dynamically-tracked signal', () => {
    const calls: number[] = [];
    const outer = createRefSignal(0);
    const inner = createRefSignal(0);

    const sub = createSubscription({
      deps: [outer],
      onFire: () => {
        calls.push(inner.current);
        if (inner.current < 3) inner.update(inner.current + 1);
      },
      options: { trackSignals: () => [inner] },
    });

    inner.update(1); // kicks off cascade: 1 → 2 → 3, then stops
    expect(calls).toEqual([1, 2, 3]);

    sub.dispose();
  });

  // ─── Same signal in both static and dynamic ──────────────────────────────

  it('handles same signal appearing in both static deps and dynamic set', () => {
    const onFire = jest.fn();
    const signal = createRefSignal(0);

    const sub = createSubscription({
      deps: [signal],
      onFire,
      options: { trackSignals: () => [signal] },
    });

    // One update fires both listeners (static + dynamic); onFire called twice
    signal.update(1);
    expect(onFire).toHaveBeenCalledTimes(2);

    // Dispose must unsubscribe both listeners — no leaks
    sub.dispose();
    onFire.mockClear();
    signal.update(2);
    expect(onFire).not.toHaveBeenCalled();
  });

  // ─── Back-compat — no trackSignals ───────────────────────────────────────

  it('without trackSignals, behaves as a plain static-deps subscription', () => {
    const onFire = jest.fn();
    const a = createRefSignal(0);
    const b = createRefSignal(0);

    const sub = createSubscription({ deps: [a, b], onFire });

    a.update(1);
    b.update(1);
    expect(onFire).toHaveBeenCalledTimes(2);

    sub.dispose();
    a.update(2);
    b.update(2);
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it('empty deps and no trackSignals is a valid no-op subscription', () => {
    const onFire = jest.fn();
    const sub = createSubscription({ deps: [], onFire });

    expect(() => {
      sub.dispose();
    }).not.toThrow();
    expect(onFire).not.toHaveBeenCalled();
  });
});
