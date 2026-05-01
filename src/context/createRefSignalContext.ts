import {
  type Context,
  createContext,
  createElement,
  FC,
  ReactNode,
  useContext,
  useMemo,
} from 'react';
import {
  useRefSignalStore,
  type SignalStoreOptions,
  type SignalStoreOptionsPlain,
  type SignalStoreOptionsUnwrapped,
  type UnwrappedStore,
} from '../store/useRefSignalStore';

// ─── Re-exports for backwards compatibility ────────────────────────────────────

export type {
  RefSignalKeys,
  UnwrappedStore,
  StoreSnapshot,
} from '../store/useRefSignalStore';

// ─── Context-specific types ────────────────────────────────────────────────────

// Overloaded call signatures — mirror `useRefSignalStore` so inline
// `{ unwrap: true, renderOn: [...] }` narrows to `UnwrappedStore<TStore>`
// without the caller needing `as const` / `satisfies` workarounds.
export interface ContextHook<TStore> {
  (options: SignalStoreOptionsUnwrapped<TStore>): UnwrappedStore<TStore>;
  (options?: SignalStoreOptionsPlain<TStore>): TStore;
  (options?: SignalStoreOptions<TStore>): TStore | UnwrappedStore<TStore>;
}

export type RefSignalContextType<TName extends string, TStore> = {
  [K in `${Capitalize<TName>}Provider`]: FC<{ children: ReactNode }>;
} & {
  [K in `use${Capitalize<TName>}Context`]: ContextHook<TStore>;
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sentinel value for `renderOn` — subscribes to all signals in the store. */
export const ALL = 'all' as const;

// ─── createRefSignalContextHook ───────────────────────────────────────────────

/**
 * Creates a React context object and a fully reactive hook for a signal store,
 * without generating a Provider component. Use this when you need to write your
 * own Provider body (custom effects, props, external subscriptions, etc.).
 *
 * @see [Decision Tree §8 — Context / Shared State](https://github.com/jav974/react-refsignal/blob/main/docs/decision-tree.md#8-context--shared-state)
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
 *   const name = useRefSignal('Alice');
 *   const score = useRefSignal(0);
 *   const store = useMemo(() => ({ name, score }), []);
 *
 *   useEffect(() => {
 *     fetchUser(userId).then(u => { name.current = u.name })
 *   }, [userId])
 *
 *   return <UserContext.Provider value={store}>{children}</UserContext.Provider>
 * }
 */
export function createRefSignalContextHook<TStore extends object>(
  name: string,
): [Context<TStore | null>, ContextHook<TStore>] {
  const capitalizedName = capitalize(name);
  const context = createContext<TStore | null>(null);
  context.displayName = `${capitalizedName}Context`;

  const hookName = `use${capitalizedName}Context`;
  const providerName = `${capitalizedName}Provider`;

  // Implementation signature; the callable overloads come from
  // `ContextHook<TStore>` — we cast once at the return so TS honors them.
  // `useRefSignalStore` is re-typed here to its union-overload shape so
  // overload resolution is unambiguous on a union-typed `options`
  // argument (some IDEs report the first-overload failure instead of
  // falling through to the matching one).
  const callUseStore = useRefSignalStore as (
    store: TStore,
    options?: SignalStoreOptions<TStore>,
  ) => TStore | UnwrappedStore<TStore>;

  function useContextHookImpl(
    options?: SignalStoreOptions<TStore>,
  ): TStore | UnwrappedStore<TStore> {
    const store = useContext(context);
    if (store === null) {
      throw new Error(`${hookName} must be used within a ${providerName}`);
    }
    return callUseStore(store, options);
  }

  return [context, useContextHookImpl as ContextHook<TStore>];
}

// ─── createRefSignalContext ───────────────────────────────────────────────────

/**
 * Creates a named React context optimized for signal stores.
 *
 * @see [Decision Tree §8 — Context / Shared State](https://github.com/jav974/react-refsignal/blob/main/docs/decision-tree.md#8-context--shared-state)
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
  TStore extends object,
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
