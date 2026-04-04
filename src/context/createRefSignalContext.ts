import {
  type Context,
  createContext,
  createElement,
  FC,
  ReactNode,
  useContext,
  useMemo,
} from 'react';
import { isRefSignal, RefSignal } from '../refsignal';
import { useRefSignalRender } from '../hooks/useRefSignalRender';
import type { TimingOptions } from '../timing';

/**
 * Extracts the keys of a store whose values are RefSignal instances.
 * Non-signal values are excluded from the resulting union type.
 *
 * @example
 * type Store = { name: RefSignal<string>; score: RefSignal<number>; sessionId: string }
 * type Keys = RefSignalKeys<Store> // 'name' | 'score'
 */
export type RefSignalKeys<TStore> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TStore]: TStore[K] extends RefSignal<any> ? K : never;
}[keyof TStore];

/**
 * Replaces each RefSignal<V> in the store with its inner value V,
 * and generates a `set${Key}` setter for each signal key.
 * Non-signal values are left unchanged. No setter is generated for them.
 *
 * @example
 * type Store = { name: RefSignal<string>; score: RefSignal<number>; sessionId: string }
 * type Unwrapped = UnwrappedStore<Store>
 * // {
 * //   name: string
 * //   score: number
 * //   sessionId: string
 * //   setName: (value: string) => void
 * //   setScore: (value: number) => void
 * // }
 */
export type UnwrappedStore<TStore> = {
  [K in keyof TStore]: TStore[K] extends RefSignal<infer V> ? V : TStore[K];
} & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TStore as TStore[K] extends RefSignal<any>
    ? `set${Capitalize<string & K>}`
    : never]: TStore[K] extends RefSignal<infer V> ? (value: V) => void : never;
};

export type StoreSnapshot<TStore> = {
  readonly [K in keyof TStore]: TStore[K] extends RefSignal<infer V>
    ? V
    : TStore[K];
};

export type ContextHookOptions<TStore> = TimingOptions & {
  renderOn?: Array<RefSignalKeys<TStore>> | 'all';
  unwrap?: boolean;
  filter?: (store: StoreSnapshot<TStore>) => boolean;
};

export type ContextHook<TStore> = {
  (options?: ContextHookOptions<TStore> & { unwrap?: false }): TStore;
  (
    options: ContextHookOptions<TStore> & { unwrap: true },
  ): UnwrappedStore<TStore>;
};

export type RefSignalContextType<TName extends string, TStore> = {
  [K in `${Capitalize<TName>}Provider`]: FC<{ children: ReactNode }>;
} & {
  [K in `use${Capitalize<TName>}Context`]: ContextHook<TStore>;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sentinel value for {@link ContextHook} `renderOn` — subscribes to all signals in the store. */
export const ALL = 'all' as const;

/**
 * Creates a React context object and a fully reactive hook for a signal store,
 * without generating a Provider component. Use this when you need to write your
 * own Provider body (custom effects, props, external subscriptions, etc.).
 *
 * The returned hook supports the same `renderOn`, `unwrap`, and timing options
 * as the hook returned by {@link createRefSignalContext}.
 *
 * @param name The context name. Used to set `displayName` on the context object.
 *
 * @returns A tuple `[Context, hook]` where:
 *   - `Context` is the raw React context — use `<Context.Provider value={store}>` in your Provider
 *   - `hook` is the typed reactive hook — call it inside any component wrapped by your Provider
 *
 * @example
 * type UserStore = { name: RefSignal<string>; score: RefSignal<number> }
 * const [UserContext, useUserContext] = createRefSignalContextHook<UserStore>('User')
 *
 * function UserProvider({ children, userId }: { children: ReactNode; userId: string }) {
 *   const store = useMemo(() => ({
 *     name: createRefSignal('Alice'),
 *     score: createRefSignal(0),
 *   }), [])
 *
 *   useEffect(() => {
 *     fetchUser(userId).then(u => { store.name.current = u.name })
 *   }, [userId])
 *
 *   return <UserContext.Provider value={store}>{children}</UserContext.Provider>
 * }
 */
export function createRefSignalContextHook<
  TStore extends Record<string, unknown>,
>(name: string): [Context<TStore | null>, ContextHook<TStore>] {
  const capitalizedName = capitalize(name);
  const context = createContext<TStore | null>(null);
  context.displayName = `${capitalizedName}Context`;

  const hookName = `use${capitalizedName}Context`;
  const providerName = `${capitalizedName}Provider`;

  const useStore = (): TStore => {
    const store = useContext(context);
    if (store === null) {
      throw new Error(`${hookName} must be used within a ${providerName}`);
    }
    return store;
  };

  function useContextHook(
    options?: ContextHookOptions<TStore> & { unwrap?: false },
  ): TStore;
  function useContextHook(
    options: ContextHookOptions<TStore> & { unwrap: true },
  ): UnwrappedStore<TStore>;
  function useContextHook(
    options?: ContextHookOptions<TStore>,
  ): TStore | UnwrappedStore<TStore> {
    const store = useStore();

    let signals: RefSignal[];
    if (options?.renderOn === 'all') {
      signals = Object.values(store).filter(isRefSignal);
    } else if (options?.renderOn !== undefined) {
      signals = options.renderOn.map((key) => store[key] as RefSignal);
    } else {
      signals = [];
    }

    const snapshot = useMemo(
      () =>
        new Proxy(store, {
          get(target, key) {
            const val = (target as Record<string | symbol, unknown>)[
              key as string
            ];
            return isRefSignal(val) ? val.current : val;
          },
        }) as StoreSnapshot<TStore>,
      [store],
    );

    const {
      renderOn: _renderOn,
      unwrap: _unwrap,
      filter,
      ...renderOptions
    } = options ?? {};
    useRefSignalRender(signals, {
      ...renderOptions,
      filter: filter ? () => filter(snapshot) : undefined,
    });

    const settersMap = useMemo(
      () =>
        Object.fromEntries(
          Object.entries(store)
            .filter(([, v]) => isRefSignal(v))
            .map(([k, v]) => [
              `set${capitalize(k)}`,
              (value: unknown) => {
                (v as RefSignal).update(value);
              },
            ]),
        ),
      [store],
    );

    const unwrappedProxy = useMemo(
      () =>
        new Proxy(store, {
          get(_, key) {
            const k = String(key);
            if (k in settersMap) return settersMap[k];
            return snapshot[k];
          },
        }) as UnwrappedStore<TStore>,
      [store, settersMap, snapshot],
    );

    if (options?.unwrap) {
      return unwrappedProxy;
    }

    return store;
  }

  return [context, useContextHook];
}

/**
 * Creates a named React context optimized for signal stores.
 *
 * Builds on {@link createRefSignalContextHook} and adds explicit per-call tracking:
 * components opt into re-renders by naming the signals they care about.
 * Components that don't pass `renderOn` never re-render on signal updates.
 *
 * @param name The context name. Generates `${name}Provider` and `use${name}Context`.
 * @param factory Called once per Provider mount. Should return an object of RefSignals
 *                (and optionally non-signal values).
 *
 * @example
 * const { UserProvider, useUserContext } = createRefSignalContext('User', () => ({
 *   name: createRefSignal('Alice'),
 *   score: createRefSignal(0),
 *   sessionId: 'abc123',
 * }))
 *
 * // No re-renders — safe for game loops, PixiJS, rAF callbacks
 * const store = useUserContext()
 * store.name.current // 'Alice'
 *
 * // Re-renders when name updates — plain value + auto-generated setter
 * const { name, setName } = useUserContext({ renderOn: ['name'], unwrap: true })
 * name           // 'Alice'
 * setName('Bob') // updates the signal
 *
 * // Re-renders when name updates, signal access
 * const store = useUserContext({ renderOn: ['name'] })
 * store.name.current // 'Alice'
 * store.name.update('Bob')
 *
 * // Re-renders on any signal update — explicit opt-in at the call site
 * const store = useUserContext({ renderOn: 'all' })
 *
 * // TypeScript error — sessionId is not a signal
 * const store = useUserContext({ renderOn: ['sessionId'] })
 */
export function createRefSignalContext<
  TName extends string,
  TStore extends Record<string, unknown>,
>(name: TName, factory: () => TStore): RefSignalContextType<TName, TStore> {
  const [context, useContextHook] = createRefSignalContextHook<TStore>(name);

  const capitalizedName = capitalize(name);
  const providerName = `${capitalizedName}Provider`;

  const Provider: FC<{ children: ReactNode }> = ({ children }) => {
    const store = useMemo(() => factory(), []);
    return createElement(context.Provider, { value: store }, children);
  };
  Provider.displayName = providerName;

  return {
    [providerName]: Provider,
    [`use${capitalizedName}Context`]: useContextHook,
  } as RefSignalContextType<TName, TStore>;
}
