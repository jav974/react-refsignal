/**
 * @jest-environment jsdom
 */
import React, { createElement, ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { createRefSignalContext } from './createRefSignalContext';
import { createRefSignal } from '../refsignal';

function makeWrapper(Provider: React.FC<{ children: ReactNode }>) {
  return ({ children }: { children: ReactNode }) =>
    createElement(Provider, null, children);
}

function makeStore() {
  return {
    name: createRefSignal('Alice'),
    score: createRefSignal(0),
    sessionId: 'abc123', // non-signal — should not appear in renderOn options
  };
}

describe('createRefSignalContext', () => {
  describe('structure', () => {
    it('returns a named Provider and hook', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      expect(typeof UserProvider).toBe('function');
      expect(typeof useUserContext).toBe('function');
    });

    it('sets displayName on the Provider', () => {
      const { UserProvider } = createRefSignalContext('User', makeStore);
      expect(UserProvider.displayName).toBe('UserProvider');
    });

    it('throws a descriptive error when hook is used outside Provider', () => {
      const { useUserContext } = createRefSignalContext('User', makeStore);
      expect(() => renderHook(() => useUserContext())).toThrow(
        'useUserContext must be used within a UserProvider',
      );
    });
  });

  describe('without renderOn — no re-renders', () => {
    it('returns the store', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      const { result } = renderHook(() => useUserContext(), {
        wrapper: makeWrapper(UserProvider),
      });
      expect(result.current.name.current).toBe('Alice');
      expect(result.current.score.current).toBe(0);
      expect(result.current.sessionId).toBe('abc123');
    });

    it('does not re-render when a signal updates', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext();
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renderCount).toBe(initial);
    });
  });

  describe('with renderOn — selective re-renders', () => {
    it('re-renders when a renderOn signal updates', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: ['name'] });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renderCount).toBeGreaterThan(initial);
    });

    it('does not re-render when an untracked signal updates', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: ['name'] });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.score.update(99);
      });
      expect(renderCount).toBe(initial);
    });

    it('re-renders when any of multiple renderOn signals update', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: ['name', 'score'] });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const after0 = renderCount;
      act(() => {
        result.current.score.update(99);
      });
      expect(renderCount).toBeGreaterThan(after0);

      const after1 = renderCount;
      act(() => {
        result.current.name.update('Charlie');
      });
      expect(renderCount).toBeGreaterThan(after1);
    });

    it('does not re-render when a tracked signal updates to same value', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: ['name'] });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.name.update('Alice'); // same value
      });
      expect(renderCount).toBe(initial);
    });
  });

  describe('unwrap', () => {
    it('returns plain values instead of signals', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      const { result } = renderHook(() => useUserContext({ unwrap: true }), {
        wrapper: makeWrapper(UserProvider),
      });

      expect(result.current.name).toBe('Alice');
      expect(result.current.score).toBe(0);
    });

    it('non-signal values pass through unchanged', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      const { result } = renderHook(() => useUserContext({ unwrap: true }), {
        wrapper: makeWrapper(UserProvider),
      });

      expect(result.current.sessionId).toBe('abc123');
    });

    it('reflects updated signal value on re-render', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        () => ({ name: createRefSignal('Alice') }),
      );

      const { result } = renderHook(
        () => ({
          raw: useUserContext(),
          view: useUserContext({ renderOn: ['name'], unwrap: true }),
        }),
        { wrapper: makeWrapper(UserProvider) },
      );

      expect(result.current.view.name).toBe('Alice');

      act(() => {
        result.current.raw.name.update('Bob');
      });

      expect(result.current.view.name).toBe('Bob');
    });

    it('generates setters for each signal key', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      const { result } = renderHook(() => useUserContext({ unwrap: true }), {
        wrapper: makeWrapper(UserProvider),
      });

      expect(typeof result.current.setName).toBe('function');
      expect(typeof result.current.setScore).toBe('function');
    });

    it('does not generate a setter for non-signal values', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      const { result } = renderHook(() => useUserContext({ unwrap: true }), {
        wrapper: makeWrapper(UserProvider),
      });

      expect((result.current as Record<string, unknown>).setSessionId).toBeUndefined();
    });

    it('setter updates the signal and triggers re-render', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        () => ({ name: createRefSignal('Alice') }),
      );

      const { result } = renderHook(
        () => useUserContext({ renderOn: ['name'], unwrap: true }),
        { wrapper: makeWrapper(UserProvider) },
      );

      expect(result.current.name).toBe('Alice');

      act(() => {
        result.current.setName('Bob');
      });

      expect(result.current.name).toBe('Bob');
    });

    it('does not re-render without renderOn even with unwrap', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        () => ({ name: createRefSignal('Alice') }),
      );

      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return {
            raw: useUserContext(),
            view: useUserContext({ unwrap: true }),
          };
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.raw.name.update('Bob');
      });
      expect(renderCount).toBe(initial);
    });
  });

  describe('provider-level rerender', () => {
    it('re-renders on all signals when rerender: true and no renderOn', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
        { rerender: true },
      );

      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext();
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => { result.current.name.update('Bob'); });
      expect(renderCount).toBeGreaterThan(initial);

      const after = renderCount;
      act(() => { result.current.score.update(99); });
      expect(renderCount).toBeGreaterThan(after);
    });

    it('does not re-render by default without rerender option', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );

      let renderCount = 0;
      const { result } = renderHook(
        () => { renderCount++; return useUserContext(); },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => { result.current.name.update('Bob'); });
      expect(renderCount).toBe(initial);
    });

    it('renderOn overrides provider rerender — fine-tunes to specific signals', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
        { rerender: true },
      );

      let renderCount = 0;
      const { result } = renderHook(
        () => { renderCount++; return useUserContext({ renderOn: ['name'] }); },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => { result.current.score.update(99); });
      expect(renderCount).toBe(initial); // score not tracked

      act(() => { result.current.name.update('Bob'); });
      expect(renderCount).toBeGreaterThan(initial); // name tracked
    });

    it('renderOn: [] opts out entirely from a rerender: true provider', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
        { rerender: true },
      );

      let renderCount = 0;
      const { result } = renderHook(
        () => { renderCount++; return useUserContext({ renderOn: [] }); },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => { result.current.name.update('Bob'); });
      act(() => { result.current.score.update(99); });
      expect(renderCount).toBe(initial);
    });
  });

  describe('isolation', () => {
    it('each Provider mount gets its own independent store', () => {
      let callCount = 0;
      const { CountProvider, useCountContext } = createRefSignalContext(
        'Count',
        () => ({ value: createRefSignal(++callCount) }),
      );

      const { result: r1 } = renderHook(() => useCountContext(), {
        wrapper: makeWrapper(CountProvider),
      });
      const { result: r2 } = renderHook(() => useCountContext(), {
        wrapper: makeWrapper(CountProvider),
      });

      expect(r1.current.value.current).toBe(1);
      expect(r2.current.value.current).toBe(2);
    });

    it('updates in one Provider do not affect another', () => {
      const { CountProvider, useCountContext } = createRefSignalContext(
        'Count',
        () => ({ value: createRefSignal(0) }),
      );

      const { result: r1 } = renderHook(
        () => useCountContext({ renderOn: ['value'] }),
        { wrapper: makeWrapper(CountProvider) },
      );
      const { result: r2 } = renderHook(
        () => useCountContext({ renderOn: ['value'] }),
        { wrapper: makeWrapper(CountProvider) },
      );

      act(() => {
        r1.current.value.update(42);
      });

      expect(r1.current.value.current).toBe(42);
      expect(r2.current.value.current).toBe(0);
    });
  });
});
