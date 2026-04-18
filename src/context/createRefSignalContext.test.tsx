/**
 * @jest-environment jsdom
 */
import React, { createElement, ReactNode } from 'react';
import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import {
  createRefSignalContext,
  createRefSignalContextHook,
  type ContextHook,
} from './createRefSignalContext';
import { createRefSignal, RefSignal } from '../refsignal';
import type {
  SignalStoreOptionsPlain,
  SignalStoreOptionsUnwrapped,
  UnwrappedStore,
} from '../store/useRefSignalStore';

function makeWrapper(Provider: React.FC<{ children: ReactNode }>) {
  return ({ children }: { children: ReactNode }) =>
    createElement(Provider, null, children);
}

// ─── Canonical test store ────────────────────────────────────────────────────

type UserStore = {
  name: RefSignal<string>;
  score: RefSignal<number>;
  sessionId: string; // non-signal — should not appear in renderOn options
};

function makeStore(): UserStore {
  return {
    name: createRefSignal('Alice'),
    score: createRefSignal(0),
    sessionId: 'abc123',
  };
}

/**
 * Typed wrapper around `createRefSignalContext` for the `'User'` context.
 * The library's return type uses template-literal keys (`${Capitalize<TName>}Provider`)
 * that several IDEs don't fully evaluate; asserting the concrete shape here
 * once unblocks type narrowing on destructuring across all tests.
 */
type UserContextResult = {
  UserProvider: React.FC<{ children: ReactNode }>;
  useUserContext: ContextHook<UserStore>;
};

function makeUserContext(
  factory: () => UserStore = makeStore,
): UserContextResult {
  return createRefSignalContext(
    'User',
    factory,
  ) as unknown as UserContextResult;
}

// Small ad-hoc store used by isolation tests — named differently so the
// Provider/hook keys prove the name-capitalization machinery.
type CountStore = { value: RefSignal<number> };
type CountContextResult = {
  CountProvider: React.FC<{ children: ReactNode }>;
  useCountContext: ContextHook<CountStore>;
};

function makeCountContext(factory: () => CountStore): CountContextResult {
  return createRefSignalContext(
    'Count',
    factory,
  ) as unknown as CountContextResult;
}

/**
 * Mount a hook that calls `useUserContext(options)` inside a `UserProvider`,
 * tracking render count. Use in every "re-render behavior" test to collapse
 * the repeated ~10-line scaffolding into one call.
 */
function mountUser(
  options?: SignalStoreOptionsPlain<UserStore>,
  factory: () => UserStore = makeStore,
) {
  const { UserProvider, useUserContext } = makeUserContext(factory);
  let renders = 0;
  const { result, rerender, unmount } = renderHook(
    () => {
      renders++;
      return useUserContext(options);
    },
    { wrapper: makeWrapper(UserProvider) },
  );
  return {
    result: result as { current: UserStore },
    rerender,
    unmount,
    renders: () => renders,
    UserProvider,
    useUserContext,
  };
}

/**
 * Variant of {@link mountUser} that forces the unwrapped overload.
 * `result.current` is typed as {@link UnwrappedStore}, so setters
 * (`setName`, `setScore`) and plain values resolve in the IDE.
 */
function mountUserUnwrapped(
  options: SignalStoreOptionsUnwrapped<UserStore>,
  factory: () => UserStore = makeStore,
) {
  const { UserProvider, useUserContext } = makeUserContext(factory);
  let renders = 0;
  const { result, rerender, unmount } = renderHook(
    () => {
      renders++;
      return useUserContext(options);
    },
    { wrapper: makeWrapper(UserProvider) },
  );
  return {
    result: result as { current: UnwrappedStore<UserStore> },
    rerender,
    unmount,
    renders: () => renders,
    UserProvider,
    useUserContext,
  };
}

describe('createRefSignalContext', () => {
  describe('structure', () => {
    it('returns a named Provider and hook', () => {
      const { UserProvider, useUserContext } = makeUserContext();
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
      expect(typeof result.CartProvider).toBe('function');
      expect(typeof result.useCartContext).toBe('function');
    });
  });

  describe('without renderOn — no re-renders', () => {
    it('does not re-render when a signal updates', () => {
      const { result, renders } = mountUser();

      const initial = renders();
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renders()).toBe(initial);
    });
  });

  describe('with renderOn — selective re-renders', () => {
    it('re-renders when a renderOn signal updates', () => {
      const { result, renders } = mountUser({ renderOn: ['name'] });

      const initial = renders();
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renders()).toBeGreaterThan(initial);
    });

    it('does not re-render when an untracked signal updates', () => {
      const { result, renders } = mountUser({ renderOn: ['name'] });

      const initial = renders();
      act(() => {
        result.current.score.update(99);
      });
      expect(renders()).toBe(initial);
    });

    it('re-renders when any of multiple renderOn signals update', () => {
      const { result, renders } = mountUser({ renderOn: ['name', 'score'] });

      const after0 = renders();
      act(() => {
        result.current.score.update(99);
      });
      expect(renders()).toBeGreaterThan(after0);

      const after1 = renders();
      act(() => {
        result.current.name.update('Charlie');
      });
      expect(renders()).toBeGreaterThan(after1);
    });

    it('filter receives the store and gates re-renders', () => {
      const { result, renders } = mountUser({
        renderOn: ['score'],
        filter: (store) => store.score > 10,
      });

      const initial = renders();
      act(() => {
        result.current.score.update(5);
      }); // below threshold — no re-render
      expect(renders()).toBe(initial);

      act(() => {
        result.current.score.update(99);
      }); // above threshold — re-renders
      expect(renders()).toBeGreaterThan(initial);
    });

    it('does not re-render when a tracked signal updates to same value', () => {
      const { result, renders } = mountUser({ renderOn: ['name'] });

      const initial = renders();
      act(() => {
        result.current.name.update('Alice'); // same value
      });
      expect(renders()).toBe(initial);
    });
  });

  describe('unwrap', () => {
    it('returns plain values instead of signals', () => {
      const { result } = mountUserUnwrapped({ unwrap: true, renderOn: 'all' });

      expect(result.current.name).toBe('Alice');
      expect(result.current.score).toBe(0);
    });

    it('non-signal values pass through unchanged', () => {
      const { result } = mountUserUnwrapped({ unwrap: true, renderOn: 'all' });

      expect(result.current.sessionId).toBe('abc123');
    });

    it('reflects updated signal value on re-render', () => {
      const { UserProvider, useUserContext } = makeUserContext();

      const { result } = renderHook(
        () => ({
          raw: useUserContext(),
          view: useUserContext({
            renderOn: ['name'],
            unwrap: true,
          }),
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
      const { result } = mountUserUnwrapped({ unwrap: true, renderOn: 'all' });

      expect(typeof result.current.setName).toBe('function');
      expect(typeof result.current.setScore).toBe('function');
    });

    it('does not generate a setter for non-signal values', () => {
      const { result } = mountUserUnwrapped({ unwrap: true, renderOn: 'all' });

      expect(
        (result.current as Record<string, unknown>).setSessionId,
      ).toBeUndefined();
    });

    it('setter updates the signal and triggers re-render', () => {
      const { result } = mountUserUnwrapped({
        renderOn: ['name'],
        unwrap: true,
      });

      expect(result.current.name).toBe('Alice');

      act(() => {
        result.current.setName('Bob');
      });

      expect(result.current.name).toBe('Bob');
    });
  });

  describe("renderOn: 'all'", () => {
    it("re-renders on all signals when renderOn: 'all'", () => {
      const { result, renders } = mountUser({ renderOn: 'all' });

      const initial = renders();
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renders()).toBeGreaterThan(initial);

      const after = renders();
      act(() => {
        result.current.score.update(99);
      });
      expect(renders()).toBeGreaterThan(after);
    });

    it('does not re-render by default without renderOn', () => {
      const { result, renders } = mountUser();

      const initial = renders();
      act(() => {
        result.current.name.update('Bob');
      });
      expect(renders()).toBe(initial);
    });
  });

  describe('resubscription stability', () => {
    it('does not accumulate listeners when component re-renders with renderOn array', () => {
      const { result, rerender, renders } = mountUser({ renderOn: ['name'] });

      // Force several re-renders — each creates a new array via .map()
      rerender();
      rerender();
      rerender();

      const baseline = renders();
      act(() => {
        result.current.name.update('Bob');
      });

      // If listeners accumulated, delta would be > 1
      expect(renders() - baseline).toBe(1);
    });

    it("does not accumulate listeners when component re-renders with renderOn: 'all'", () => {
      const { result, rerender, renders } = mountUser({ renderOn: 'all' });

      rerender();
      rerender();
      rerender();

      const baseline = renders();
      act(() => {
        result.current.name.update('Bob');
      });

      expect(renders() - baseline).toBe(1);
    });
  });

  describe('isolation', () => {
    it('each Provider mount gets its own independent store', () => {
      let callCount = 0;
      const { CountProvider, useCountContext } = makeCountContext(() => ({
        value: createRefSignal(++callCount),
      }));

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
      const { CountProvider, useCountContext } = makeCountContext(() => ({
        value: createRefSignal(0),
      }));

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

      const UserProvider = ({ children }: { children: ReactNode }) => (
        <UserContext.Provider value={makeStore()}>
          {children}
        </UserContext.Provider>
      );

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
        ({ children }: { children: ReactNode }) => (
          <UserContext.Provider
            value={{ ...makeStore(), name: createRefSignal(initial) }}
          >
            {children}
          </UserContext.Provider>
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
