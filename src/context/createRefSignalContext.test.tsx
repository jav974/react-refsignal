/**
 * @jest-environment jsdom
 */
import React, { createElement, ReactNode } from 'react';
import { act } from 'react';
import { renderHook } from '@testing-library/react';
import {
  createRefSignalContext,
  createRefSignalContextHook,
} from './createRefSignalContext';
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

    it('capitalizes the name when passed in lowercase', () => {
      const result = createRefSignalContext('cart', makeStore);
      expect(typeof (result as Record<string, unknown>).CartProvider).toBe(
        'function',
      );
      expect(typeof (result as Record<string, unknown>).useCartContext).toBe(
        'function',
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

    it('filter receives the store and gates re-renders', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({
            renderOn: ['score'],
            filter: (store) => store.score > 10,
          });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.score.update(5);
      }); // below threshold — no re-render
      expect(renderCount).toBe(initial);

      act(() => {
        result.current.score.update(99);
      }); // above threshold — re-renders
      expect(renderCount).toBeGreaterThan(initial);
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

      expect(
        (result.current as Record<string, unknown>).setSessionId,
      ).toBeUndefined();
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

  describe("renderOn: 'all'", () => {
    it("re-renders on all signals when renderOn: 'all'", () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );

      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: 'all' });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renderCount).toBeGreaterThan(initial);

      const after = renderCount;
      act(() => {
        result.current.score.update(99);
      });
      expect(renderCount).toBeGreaterThan(after);
    });

    it('does not re-render by default without renderOn', () => {
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

  describe('resubscription stability', () => {
    it('does not accumulate listeners when component re-renders with renderOn array', () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );

      let renderCount = 0;
      const { result, rerender } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: ['name'] });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      // Force several re-renders — each creates a new array via .map()
      rerender();
      rerender();
      rerender();

      renderCount = 0;
      act(() => {
        result.current.name.update('Bob');
      });

      // If listeners accumulated, renderCount would be > 1
      expect(renderCount).toBe(1);
    });

    it("does not accumulate listeners when component re-renders with renderOn: 'all'", () => {
      const { UserProvider, useUserContext } = createRefSignalContext(
        'User',
        makeStore,
      );

      let renderCount = 0;
      const { result, rerender } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: 'all' });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      rerender();
      rerender();
      rerender();

      renderCount = 0;
      act(() => {
        result.current.name.update('Bob');
      });

      expect(renderCount).toBe(1);
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

// ---------------------------------------------------------------------------

type UserStore = ReturnType<typeof makeStore>;

describe('createRefSignalContextHook', () => {
  describe('structure', () => {
    it('returns a tuple of [Context, hook]', () => {
      const result = createRefSignalContextHook<UserStore>('User');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      const [context, hook] = result;
      expect(typeof context).toBe('object');
      expect(typeof hook).toBe('function');
    });

    it('sets displayName on the context object', () => {
      const [context] = createRefSignalContextHook<UserStore>('User');
      expect(context.displayName).toBe('UserContext');
    });

    it('throws a descriptive error when hook is used outside a Provider', () => {
      const [, useUserContext] = createRefSignalContextHook<UserStore>('User');
      expect(() => renderHook(() => useUserContext())).toThrow(
        'useUserContext must be used within a UserProvider',
      );
    });

    it('capitalizes the name when passed in lowercase', () => {
      const [context, hook] = createRefSignalContextHook<UserStore>('cart');
      expect(context.displayName).toBe('CartContext');
      expect(() => renderHook(() => hook())).toThrow(
        'useCartContext must be used within a CartProvider',
      );
    });
  });

  describe('with a user-written Provider', () => {
    function makeContextAndProvider() {
      const [UserContext, useUserContext] =
        createRefSignalContextHook<UserStore>('User');

      const UserProvider = ({ children }: { children: ReactNode }) =>
        createElement(UserContext.Provider, { value: makeStore() }, children);

      return { UserProvider, useUserContext };
    }

    it('returns the store when used inside the Provider', () => {
      const { UserProvider, useUserContext } = makeContextAndProvider();
      const { result } = renderHook(() => useUserContext(), {
        wrapper: makeWrapper(UserProvider),
      });
      expect(result.current.name.current).toBe('Alice');
      expect(result.current.score.current).toBe(0);
      expect(result.current.sessionId).toBe('abc123');
    });

    it('does not re-render without renderOn', () => {
      const { UserProvider, useUserContext } = makeContextAndProvider();
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

    it('re-renders when a renderOn signal updates', () => {
      const { UserProvider, useUserContext } = makeContextAndProvider();
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
      const { UserProvider, useUserContext } = makeContextAndProvider();
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

    it("re-renders on all signals when renderOn: 'all'", () => {
      const { UserProvider, useUserContext } = makeContextAndProvider();
      let renderCount = 0;
      const { result } = renderHook(
        () => {
          renderCount++;
          return useUserContext({ renderOn: 'all' });
        },
        { wrapper: makeWrapper(UserProvider) },
      );

      const initial = renderCount;
      act(() => {
        result.current.score.update(99);
      });
      expect(renderCount).toBeGreaterThan(initial);
    });

    it('unwrap returns plain values and setters', () => {
      const { UserProvider, useUserContext } = makeContextAndProvider();
      const { result } = renderHook(
        () => useUserContext({ renderOn: ['name'], unwrap: true }),
        { wrapper: makeWrapper(UserProvider) },
      );

      expect(result.current.name).toBe('Alice');
      expect(typeof result.current.setName).toBe('function');

      act(() => {
        result.current.setName('Bob');
      });
      expect(result.current.name).toBe('Bob');
    });

    it('two Provider instances are isolated', () => {
      const [UserContext, useUserContext] =
        createRefSignalContextHook<UserStore>('User');

      const makeProvider =
        (initial: string) =>
        ({ children }: { children: ReactNode }) =>
          createElement(
            UserContext.Provider,
            { value: { ...makeStore(), name: createRefSignal(initial) } },
            children,
          );

      const { result: r1 } = renderHook(() => useUserContext(), {
        wrapper: makeWrapper(makeProvider('Alice')),
      });
      const { result: r2 } = renderHook(() => useUserContext(), {
        wrapper: makeWrapper(makeProvider('Bob')),
      });

      expect(r1.current.name.current).toBe('Alice');
      expect(r2.current.name.current).toBe('Bob');
    });
  });
});
