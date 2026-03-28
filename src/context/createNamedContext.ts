import {
  createContext,
  createElement,
  FC,
  ReactNode,
  useContext,
  useMemo,
} from 'react';

export type NamedContextType<TName extends string, TStore> = {
  [K in `${TName}Provider`]: FC<{ children: ReactNode }>;
} & {
  [K in `use${TName}Context`]: () => TStore;
};

/**
 * Shared internals used by both createNamedContext and createRefSignalContext.
 * Not exported from the public index — internal use only.
 */
export function createContextCore<TStore>(
  name: string,
  factory: () => TStore,
): {
  providerName: string;
  hookName: string;
  Provider: FC<{ children: ReactNode }>;
  useStore: () => TStore;
} {
  const Context = createContext<TStore | null>(null);
  Context.displayName = `${name}Context`;

  const providerName = `${name}Provider`;
  const hookName = `use${name}Context`;

  const Provider: FC<{ children: ReactNode }> = ({ children }) => {
    const store = useMemo(() => factory(), []);
    return createElement(Context.Provider, { value: store }, children);
  };
  Provider.displayName = providerName;

  const useStore = (): TStore => {
    const store = useContext(Context);
    if (store === null) {
      throw new Error(`${hookName} must be used within a ${providerName}`);
    }
    return store;
  };

  return { providerName, hookName, Provider, useStore };
}

/**
 * Creates a named React context with a Provider component and a typed hook.
 *
 * Eliminates the boilerplate of writing createContext + Provider + useXxxContext
 * for every domain. The factory is called once per Provider mount, making the
 * returned store stable for the lifetime of the Provider.
 *
 * @param name The context name. Used to generate the hook (`use${name}Context`)
 *             and set displayName on both the Provider and the context.
 * @param factory A function that creates and returns the store object.
 *                Called once per Provider mount — treat it like a constructor.
 *
 * @returns An object with:
 *   - `${name}Provider` — mounts the context and creates the store
 *   - `use${name}Context` — retrieves the store; throws outside Provider
 *
 * @example
 * const { UserProvider, useUserContext } = createNamedContext(
 *   'User',
 *   () => ({ name: 'Alice', role: 'admin' })
 * )
 *
 * function App() {
 *   return <UserProvider><Profile /></UserProvider>
 * }
 *
 * function Profile() {
 *   const { name } = useUserContext()
 *   return <div>{name}</div>
 * }
 */
export function createNamedContext<TName extends string, TStore>(
  name: TName,
  factory: () => TStore,
): NamedContextType<TName, TStore> {
  const { providerName, hookName, Provider, useStore } = createContextCore(
    name,
    factory,
  );

  return {
    [providerName]: Provider,
    [hookName]: useStore,
  } as NamedContextType<TName, TStore>;
}
