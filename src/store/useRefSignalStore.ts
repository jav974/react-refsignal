import { useMemo } from 'react';
import { isRefSignal, RefSignal } from '../refsignal';
import { useRefSignalRender } from '../hooks/useRefSignalRender';
import type { EffectOptions } from '../hooks/useRefSignalEffect';
import type { TimingOptions } from '../timing';

// ─── Shared store types ────────────────────────────────────────────────────────

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

type BaseStoreOptions<TStore> = TimingOptions & {
  filter?: (store: StoreSnapshot<TStore>) => boolean;
};

/**
 * Options accepted by `useRefSignalStore`. Shape depends on `unwrap`:
 * - `unwrap: true` (Unwrapped variant) requires `renderOn` — unwrapping
 *   produces plain values; without `renderOn` the component would never
 *   re-render on signal changes, so the plain values would be stale
 *   immediately. Enforced at the type level to prevent this foot-gun.
 * - `unwrap` omitted/false (Plain variant) makes `renderOn` optional.
 */
export type SignalStoreOptionsUnwrapped<TStore> = BaseStoreOptions<TStore> & {
  renderOn: Array<RefSignalKeys<TStore>> | 'all';
  unwrap: true;
};

export type SignalStoreOptionsPlain<TStore> = BaseStoreOptions<TStore> & {
  renderOn?: Array<RefSignalKeys<TStore>> | 'all';
  unwrap?: false;
};

export type SignalStoreOptions<TStore> =
  | SignalStoreOptionsPlain<TStore>
  | SignalStoreOptionsUnwrapped<TStore>;

// ─── Internal helper ───────────────────────────────────────────────────────────

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Connects a signal store to a React component — with opt-in re-renders,
 * timing options, filtering, and optional value unwrapping.
 *
 * The store can come from {@link createRefSignalStore} (module-scope singleton),
 * from a React context via `useContext`, or from any other source.
 *
 * Components opt into re-renders explicitly via `renderOn`. Without it, the
 * component can read `signal.current` imperatively but never re-renders on
 * signal updates.
 *
 * @example
 * const gameStore = createRefSignalStore(() => ({
 *   score: createRefSignal(0),
 *   level: createRefSignal(1),
 * }));
 *
 * // No re-renders — read imperatively (game loops, rAF callbacks)
 * const store = useRefSignalStore(gameStore);
 *
 * // Re-render when score changes
 * const store = useRefSignalStore(gameStore, { renderOn: ['score'] });
 *
 * // Re-render when any signal changes
 * const store = useRefSignalStore(gameStore, { renderOn: 'all' });
 *
 * // Re-render when score changes — plain value + auto-generated setter
 * const { score, setScore } = useRefSignalStore(gameStore, {
 *   renderOn: ['score'],
 *   unwrap: true,
 * });
 *
 * // Rate-limit re-renders
 * const store = useRefSignalStore(gameStore, { renderOn: ['score'], throttle: 100 });
 */
// Overloads: TS overload resolution preserves literal types in inline object
// literals better than a single signature with a conditional return type —
// avoids the "unwrap: true is widened to boolean" footgun across IDEs.
// Order matters: the two literal-narrowed overloads come first so inline
// `{ unwrap: true, renderOn: [...] }` resolves to the unwrapped return type.
// The union overload is the fallback for callers that hold a pre-typed
// `SignalStoreOptions<TStore>` variable (e.g. context-hook wrappers).
export function useRefSignalStore<TStore extends object>(
  store: TStore,
  options: SignalStoreOptionsUnwrapped<TStore>,
): UnwrappedStore<TStore>;
export function useRefSignalStore<TStore extends object>(
  store: TStore,
  options?: SignalStoreOptionsPlain<TStore>,
): TStore;
export function useRefSignalStore<TStore extends object>(
  store: TStore,
  options?: SignalStoreOptions<TStore>,
): TStore | UnwrappedStore<TStore>;
export function useRefSignalStore<TStore extends object>(
  store: TStore,
  options?: SignalStoreOptions<TStore>,
): TStore | UnwrappedStore<TStore> {
  // ── Resolve which signals to subscribe to ─────────────────────────────────
  let signals: RefSignal[];
  if (options?.renderOn === 'all') {
    signals = Object.values(store).filter(isRefSignal);
  } else if (options?.renderOn !== undefined) {
    signals = options.renderOn.map((key) => store[key] as RefSignal);
  } else {
    signals = [];
  }

  // ── Snapshot proxy — unwraps .current for filter and unwrap ───────────────
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

  // ── Subscribe and schedule re-renders ─────────────────────────────────────
  const {
    renderOn: _renderOn,
    unwrap: _unwrap,
    filter,
    ...renderOptions
  } = options ?? {};
  useRefSignalRender(signals, {
    ...renderOptions,
    filter: filter ? () => filter(snapshot) : undefined,
  } as EffectOptions);

  // ── Setters map for unwrap ─────────────────────────────────────────────────
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
          return (snapshot as Record<string, unknown>)[k];
        },
      }) as UnwrappedStore<TStore>,
    [store, settersMap, snapshot],
  );

  return options?.unwrap ? unwrappedProxy : store;
}
