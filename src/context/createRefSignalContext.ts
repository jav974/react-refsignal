import {
  createContext,
  createElement,
  FC,
  ReactNode,
  useContext,
  useMemo,
} from 'react';
import { isRefSignal, RefSignal } from '../refsignal';
import { useRefSignalRender } from '../hooks/useRefSignalRender';

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

type ContextHook<TStore> = {
  (options?: {
    renderOn?: Array<RefSignalKeys<TStore>>;
    unwrap?: false;
  }): TStore;
  (options: {
    renderOn?: Array<RefSignalKeys<TStore>>;
    unwrap: true;
  }): UnwrappedStore<TStore>;
};

export interface RefSignalContextOptions {
  /**
   * When true, all signals in the store are automatically subscribed to
   * for re-renders. Acts as the domain-level default — components using
   * the hook without `renderOn` will re-render on any signal update.
   *
   * Components can always override with `renderOn` for fine-grained control,
   * or pass `renderOn: []` to explicitly opt out.
   *
   * @default false
   */
  rerender?: boolean;
}

export type RefSignalContextType<TName extends string, TStore> = {
  [K in `${TName}Provider`]: FC<{ children: ReactNode }>;
} & {
  [K in `use${TName}Context`]: ContextHook<TStore>;
};

/**
 * Creates a named React context optimized for signal stores.
 *
 * Builds on {@link createNamedContext} and adds explicit per-call tracking:
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
 * // TypeScript error — sessionId is not a signal
 * const store = useUserContext({ renderOn: ['sessionId'] })
 *
 * // Provider-level rerender: all signals subscribed by default
 * const { UserProvider, useUserContext } = createRefSignalContext('User', factory, { rerender: true })
 * const store = useUserContext()                        // subscribes to all signals
 * const store = useUserContext({ renderOn: ['name'] })  // fine-tune: only name
 * const store = useUserContext({ renderOn: [] })        // opt-out: no re-renders
 */
export function createRefSignalContext<
  TName extends string,
  TStore extends Record<string, unknown>,
>(
  name: TName,
  factory: () => TStore,
  contextOptions?: RefSignalContextOptions,
): RefSignalContextType<TName, TStore> {
  const Context = createContext<TStore | null>(null);
  Context.displayName = `${name}Context`;

  const providerName = `${name}Provider`;
  const hookName = `use${name}Context`;

  const Provider: FC<{ children: ReactNode }> = ({ children }) => {
    const store = useMemo(() => factory(), []);
    return createElement(Context.Provider, { value: store }, children);
  };
  Provider.displayName = providerName;

  const useBaseContext = (): TStore => {
    const store = useContext(Context);
    if (store === null) {
      throw new Error(`${hookName} must be used within a ${providerName}`);
    }
    return store;
  };

  const useContextHook = (options?: {
    renderOn?: Array<RefSignalKeys<TStore>>;
    unwrap?: boolean;
  }): TStore | UnwrappedStore<TStore> => {
    const store = useBaseContext();

    let signals: RefSignal[];
    if (options?.renderOn !== undefined) {
      // Explicit renderOn — fine-tuning, replaces provider default
      signals = options.renderOn.map((key) => store[key] as RefSignal);
    } else if (contextOptions?.rerender) {
      // Provider default — all signals
      signals = Object.values(store).filter(isRefSignal);
    } else {
      signals = [];
    }

    useRefSignalRender(signals);

    if (options?.unwrap) {
      const entries: [string, unknown][] = [];
      for (const [k, v] of Object.entries(store)) {
        if (isRefSignal(v)) {
          entries.push([k, v.current]);
          entries.push([
            `set${k.charAt(0).toUpperCase()}${k.slice(1)}`,
            (value: unknown) => {
              v.update(value);
            },
          ]);
        } else {
          entries.push([k, v]);
        }
      }
      return Object.fromEntries(entries) as UnwrappedStore<TStore>;
    }

    return store;
  };

  return {
    [providerName]: Provider,
    [hookName]: useContextHook,
  } as RefSignalContextType<TName, TStore>;
}
