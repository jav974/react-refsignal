/**
 * @jest-environment jsdom
 */
import React, { ReactNode } from 'react';
import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { createRefSignal, watch } from '../refsignal';
import { createRefSignalStore } from './createRefSignalStore';
import {
  useRefSignalStore,
  type SignalStoreOptionsPlain,
  type SignalStoreOptionsUnwrapped,
  type UnwrappedStore,
} from './useRefSignalStore';
import { ALL } from '../context/createRefSignalContext';

type GameStore = {
  score: ReturnType<typeof createRefSignal<number>>;
  level: ReturnType<typeof createRefSignal<number>>;
  tag: string;
};

function makeStore(): GameStore {
  return {
    score: createRefSignal(0),
    level: createRefSignal(1),
    tag: 'game', // non-signal passthrough
  };
}

/**
 * Mount `useRefSignalStore` over a fresh store, tracking render count.
 * Collapses the `let renderCount = 0; renderHook(() => { renderCount++; ... })`
 * scaffolding that repeated across every behavior test.
 */
function mountStore(options?: SignalStoreOptionsPlain<GameStore>) {
  const store = createRefSignalStore(makeStore);
  let renders = 0;
  const { result, rerender, unmount } = renderHook(() => {
    renders++;
    return useRefSignalStore(store, options);
  });
  return {
    store,
    result: result as { current: GameStore },
    rerender,
    unmount,
    renders: () => renders,
  };
}

/**
 * Variant that forces the unwrapped overload. `result.current` is typed as
 * {@link UnwrappedStore} so setters resolve in the IDE.
 */
function mountStoreUnwrapped(options: SignalStoreOptionsUnwrapped<GameStore>) {
  const store = createRefSignalStore(makeStore);
  const renders = 0;
  const { result, rerender, unmount } = renderHook(() =>
    useRefSignalStore(store, options),
  );
  return {
    store,
    result: result as { current: UnwrappedStore<GameStore> },
    rerender,
    unmount,
    renders: () => renders,
  };
}

// ─── createRefSignalStore ─────────────────────────────────────────────────────

describe('createRefSignalStore', () => {
  it('returns the plain store object', () => {
    const store = createRefSignalStore(makeStore);
    expect(typeof store.score.current).toBe('number');
    expect(typeof store.level.current).toBe('number');
    expect(store.tag).toBe('game');
  });

  it('calls factory exactly once', () => {
    const factory = jest.fn(makeStore);
    createRefSignalStore(factory);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('signals are directly accessible and mutable outside React', () => {
    const store = createRefSignalStore(makeStore);
    store.score.update(99);
    expect(store.score.current).toBe(99);
  });

  it('two calls produce independent stores', () => {
    const a = createRefSignalStore(makeStore);
    const b = createRefSignalStore(makeStore);
    a.score.update(10);
    expect(b.score.current).toBe(0);
  });
});

// ─── useRefSignalStore ────────────────────────────────────────────────────────

describe('useRefSignalStore — no renderOn', () => {
  it('returns the same store reference and does not re-render on updates', () => {
    const { store, result, renders } = mountStore();
    expect(result.current).toBe(store); // same reference, no proxy/wrapper
    act(() => {
      store.score.update(42);
    });
    expect(renders()).toBe(1);
  });
});

describe('useRefSignalStore — renderOn specific signals', () => {
  it('re-renders when the subscribed signal updates', async () => {
    const { store, result } = mountStore({ renderOn: ['score'] });
    expect(result.current.score.current).toBe(0);
    act(() => {
      store.score.update(7);
    });
    expect(result.current.score.current).toBe(7);
  });

  it('does not re-render when an unsubscribed signal updates', () => {
    const { store, renders } = mountStore({ renderOn: ['score'] });
    act(() => {
      store.level.update(5);
    });
    expect(renders()).toBe(1);
  });

  it('re-renders when any listed signal updates', () => {
    const { store, renders } = mountStore({ renderOn: ['score', 'level'] });
    act(() => {
      store.score.update(1);
    });
    act(() => {
      store.level.update(2);
    });
    expect(renders()).toBe(3); // initial + 2 updates
  });
});

describe('useRefSignalStore — renderOn: ALL', () => {
  it('re-renders on any signal update', () => {
    const { store, renders } = mountStore({ renderOn: ALL });
    act(() => {
      store.score.update(1);
    });
    act(() => {
      store.level.update(2);
    });
    expect(renders()).toBe(3);
  });
});

describe('useRefSignalStore — filter', () => {
  it('skips re-render when filter returns false', () => {
    const { store, renders } = mountStore({
      renderOn: ['score'],
      filter: (s) => s.score > 10,
    });
    act(() => {
      store.score.update(5);
    }); // filtered out
    expect(renders()).toBe(1);
    act(() => {
      store.score.update(20);
    }); // passes filter
    expect(renders()).toBe(2);
  });
});

describe('useRefSignalStore — unwrap', () => {
  it('returns plain values and auto-generated setters', () => {
    const { result } = mountStoreUnwrapped({
      renderOn: ['score'],
      unwrap: true,
    });
    expect(result.current.score).toBe(0);
    expect(typeof result.current.setScore).toBe('function');
    act(() => {
      result.current.setScore(99);
    });
    expect(result.current.score).toBe(99);
  });

  it('passes through non-signal values without a setter', () => {
    const { result } = mountStoreUnwrapped({
      renderOn: ['score'],
      unwrap: true,
    });
    expect(result.current.tag).toBe('game');
    expect((result.current as Record<string, unknown>).setTag).toBeUndefined();
  });
});

describe('useRefSignalStore — timing options', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('throttle: limits re-renders to at most once per window', () => {
    const { store, renders } = mountStore({
      renderOn: ['score'],
      throttle: 100,
    });
    act(() => {
      store.score.update(1);
    }); // leading edge fires
    act(() => {
      store.score.update(2);
    });
    act(() => {
      store.score.update(3);
    }); // trailing pending
    expect(renders()).toBe(2); // initial + leading
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renders()).toBe(3); // + trailing
  });

  it('debounce: only re-renders after quiet period', () => {
    const { store, renders } = mountStore({
      renderOn: ['score'],
      debounce: 100,
    });
    act(() => {
      store.score.update(1);
    });
    act(() => {
      store.score.update(2);
    });
    expect(renders()).toBe(1); // no re-render yet
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renders()).toBe(2);
  });
});

describe('useRefSignalStore — shared store across components', () => {
  it('multiple components using the same store share the same state', () => {
    const store = createRefSignalStore(makeStore);

    const { result: a } = renderHook(() =>
      useRefSignalStore(store, { renderOn: ['score'] }),
    );
    const { result: b } = renderHook(() =>
      useRefSignalStore(store, { renderOn: ['score'] }),
    );

    act(() => {
      store.score.update(42);
    });
    expect(a.current.score.current).toBe(42);
    expect(b.current.score.current).toBe(42);
  });
});

describe('useRefSignalStore — resubscription stability', () => {
  it('does not accumulate listeners on re-render', () => {
    const store = createRefSignalStore(makeStore);
    const { rerender } = renderHook(() =>
      useRefSignalStore(store, { renderOn: ['score'] }),
    );
    rerender();
    rerender();
    // The signal should have exactly 1 active subscription regardless of re-renders
    let fireCount = 0;
    const stop = watch(store.score, () => {
      fireCount++;
    });
    act(() => {
      store.score.update(1);
    });
    stop();
    expect(fireCount).toBe(1);
  });
});

describe('useRefSignalStore — composition with context', () => {
  it('works when store comes from React context (createRefSignalContext path)', () => {
    // createRefSignalContext internally uses useRefSignalStore — this is an integration smoke test
    const { createRefSignalContext } = jest.requireActual(
      '../context/createRefSignalContext',
    );
    const { GameProvider, useGameContext } = createRefSignalContext(
      'Game',
      makeStore,
    );

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(GameProvider, null, children);

    const { result } = renderHook(
      () => useGameContext({ renderOn: ['score'] }),
      { wrapper },
    );
    act(() => {
      result.current.score.update(5);
    });
    expect(result.current.score.current).toBe(5);
  });
});
