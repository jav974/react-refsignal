/**
 * @jest-environment jsdom
 */

import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { createRefSignal, RefSignal } from '../refsignal';
import { useRefSignalFollow } from './useRefSignalFollow';

describe('useRefSignalFollow', () => {
  it('returns the inner signal value on mount', () => {
    const inner = createRefSignal(42);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', inner]]),
    );

    const { result } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('a'), [nodes]),
    );

    expect(result.current.current).toBe(42);
  });

  it('returns undefined when the getter resolves to null', () => {
    const nodes = createRefSignal(new Map<string, RefSignal<number>>());

    const { result } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('missing'), [nodes]),
    );

    expect(result.current.current).toBeUndefined();
  });

  it('updates when the tracked inner signal fires', () => {
    const inner = createRefSignal(10);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', inner]]),
    );

    const { result } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('a'), [nodes]),
    );

    expect(result.current.current).toBe(10);

    act(() => {
      inner.update(99);
    });

    expect(result.current.current).toBe(99);
  });

  it('swaps subscription when the static dep fires and getter resolves a different inner signal', () => {
    const innerA = createRefSignal(1);
    const innerB = createRefSignal(100);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', innerA]]),
    );

    const { result } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('a'), [nodes]),
    );

    expect(result.current.current).toBe(1);

    // Swap inner via static dep
    act(() => {
      const m = new Map(nodes.current);
      m.set('a', innerB);
      nodes.update(m);
    });

    expect(result.current.current).toBe(100);

    // innerA should no longer drive updates
    act(() => {
      innerA.update(999);
    });
    expect(result.current.current).toBe(100);

    // innerB does
    act(() => {
      innerB.update(42);
    });
    expect(result.current.current).toBe(42);
  });

  it('resolves to undefined after getter starts returning nullish', () => {
    const inner = createRefSignal('hello');
    const nodes = createRefSignal(
      new Map<string, RefSignal<string>>([['a', inner]]),
    );

    const { result } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('a'), [nodes]),
    );

    expect(result.current.current).toBe('hello');

    act(() => {
      const m = new Map(nodes.current);
      m.delete('a');
      nodes.update(m);
    });

    expect(result.current.current).toBeUndefined();

    // Prior inner must no longer drive updates
    act(() => {
      inner.update('ignored');
    });
    expect(result.current.current).toBeUndefined();
  });

  it('passes filter through — blocks inner fires when filter returns false', () => {
    const inner = createRefSignal(1);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', inner]]),
    );
    let allow = false;

    const { result } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('a'), [nodes], {
        filter: () => allow,
      }),
    );

    expect(result.current.current).toBe(1);

    act(() => {
      inner.update(2);
    });
    expect(result.current.current).toBe(1); // blocked

    allow = true;
    act(() => {
      inner.update(3);
    });
    expect(result.current.current).toBe(3);
  });

  it('cleanup unsubscribes from the currently-tracked inner on unmount', () => {
    const inner = createRefSignal(0);
    const nodes = createRefSignal(
      new Map<string, RefSignal<number>>([['a', inner]]),
    );
    const unsubSpy = jest.spyOn(inner, 'unsubscribe');

    const { unmount } = renderHook(() =>
      useRefSignalFollow(() => nodes.current.get('a'), [nodes]),
    );

    unmount();

    // Inner should be unsubscribed — spy receives at least one call.
    expect(unsubSpy).toHaveBeenCalled();
  });
});
