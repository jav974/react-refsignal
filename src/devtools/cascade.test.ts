/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { createComputedRefSignal, createRefSignal, watch } from '../refsignal';
import { useRefSignalMemo } from '../hooks/useRefSignalMemo';
import { renderHook } from '../test-utils/renderHook';
import { watchSignals } from '../watchSignals';
import { devtools } from './adapter';

describe('cascade attribution', () => {
  beforeEach(() => {
    devtools.reset();
  });

  afterEach(() => {
    devtools.reset();
  });

  it('records an edge A → B when watch(A) writes B', () => {
    const a = createRefSignal(0, 'A');
    const b = createRefSignal(0, 'B');
    const stop = watch(a, (v) => {
      b.update(v * 2);
    });

    a.update(5);

    const edges = devtools.getCascadeEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'A', to: 'B', count: 1 });

    stop();
  });

  it('attributes signal:update events to the triggering effect', () => {
    const a = createRefSignal(0, 'AA');
    const b = createRefSignal(0, 'BB');
    const stop = watch(a, () => {
      b.update(b.current + 1);
    });

    a.update(1);

    const events = devtools.getEvents();
    const bUpdate = events.find(
      (e) =>
        e.kind === 'signal:update' &&
        (e as unknown as { id: string }).id === 'BB',
    );
    expect(bUpdate).toBeDefined();
    expect((bUpdate as unknown as { triggeredBy: string }).triggeredBy).toMatch(
      /^w_\d+$/,
    );

    stop();
  });

  it('emits effect:start and effect:end events around watch listener', () => {
    const a = createRefSignal(0, 'X');
    const stop = watch(a, () => {});

    a.update(1);

    const events = devtools.getEvents();
    const starts = events.filter((e) => e.kind === 'effect:start');
    const ends = events.filter((e) => e.kind === 'effect:end');
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);
    expect((starts[0] as unknown as { effectId: string }).effectId).toBe(
      (ends[0] as unknown as { effectId: string }).effectId,
    );

    stop();
  });

  it('records a cascade edge from a watchSignals dep to a downstream write', () => {
    const upA = createRefSignal(0, 'upA');
    const upB = createRefSignal(0, 'upB');
    const down = createRefSignal(0, 'down');

    const handle = watchSignals([upA, upB], () => {
      down.update(upA.current + upB.current);
    });

    upA.update(2);

    const edges = devtools.getCascadeEdges();
    // Both deps attribute to the downstream write — fan-in over-approximation.
    const keys = edges.map((e) => `${e.from}->${e.to}`);
    expect(keys).toContain('upA->down');
    expect(keys).toContain('upB->down');

    handle.dispose();
  });

  it('does not attribute writes to the same signal as a self-edge', () => {
    const s = createRefSignal(0, 'self');
    const stop = watch(s, (v) => {
      if (v < 3) s.update(v + 1);
    });

    s.update(1);

    const edges = devtools.getCascadeEdges();
    expect(edges.every((e) => e.from !== e.to)).toBe(true);

    stop();
  });

  it('records edges from useRefSignalMemo deps to the memoized signal', () => {
    const a = createRefSignal(1, 'memoA');
    const b = createRefSignal(2, 'memoB');
    const { result } = renderHook(() =>
      useRefSignalMemo(() => a.current + b.current, [a, b]),
    );
    // Hook returns a ReadonlyRefSignal; the user-facing wrapper hides
    // dispose but the memo subscribes via watchSignals on mount.
    act(() => {
      a.update(10);
    });
    act(() => {
      b.update(20);
    });
    const edges = devtools.getCascadeEdges();
    const memoName = devtools.getSignalName(result.current) ?? '?';
    const keys = edges.map((e) => `${e.from}->${e.to}`);
    expect(keys).toContain(`memoA->${memoName}`);
    expect(keys).toContain(`memoB->${memoName}`);
  });

  it('records edges from createComputedRefSignal deps to the derived signal', () => {
    const a = createRefSignal(1, 'compA');
    const b = createRefSignal(2, 'compB');
    const sum = createComputedRefSignal(() => a.current + b.current, [a, b]);
    // Need to subscribe so the computed actually recomputes
    const stop = watch(sum, () => undefined);
    a.update(10);
    b.update(20);

    const edges = devtools.getCascadeEdges();
    const keys = edges.map((e) => `${e.from}->${e.to}`);
    const sumName = devtools.getSignalName(sum) ?? '?';
    expect(keys).toContain(`compA->${sumName}`);
    expect(keys).toContain(`compB->${sumName}`);

    stop();
    sum.dispose();
  });

  it('increments edge count when the same cascade fires repeatedly', () => {
    const a = createRefSignal(0, 'aRep');
    const b = createRefSignal(0, 'bRep');
    const stop = watch(a, (v) => {
      b.update(v);
    });

    a.update(1);
    a.update(2);
    a.update(3);

    const edge = devtools
      .getCascadeEdges()
      .find((e) => e.from === 'aRep' && e.to === 'bRep');
    expect(edge?.count).toBe(3);

    stop();
  });
});
