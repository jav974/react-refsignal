import { useMemo } from 'react';
import { isRefSignal, RefSignal, type ReadonlyRefSignal } from '../refsignal';
import { useRefSignalRender } from '../hooks/useRefSignalRender';
import type { EffectOptions } from '../hooks/useRefSignalEffect';
import type { TimingOptions } from '../timing';

// ─── Shared store types ────────────────────────────────────────────────────────

/**
 * Extracts the keys of a store whose values are readable signals —
 * `RefSignal` or `ReadonlyRefSignal` (computed / memo / followed signals).
 * Subscribing is a read-side operation, so render-side options accept both.
 * Non-signal values are excluded from the resulting union type.
 *
 * @example
 * type Store = { name: RefSignal<string>; upper: ReadonlyRefSignal<string>; sessionId: string }
 * type Keys = RefSignalKeys<Store> // 'name' | 'upper'
 */
export type RefSignalKeys<TStore> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TStore]: TStore[K] extends ReadonlyRefSignal<any> ? K : never;
}[keyof TStore];

/**
 * Replaces each readable signal in the store with its inner value V, and
 * generates a `set${Key}` setter for each *writable* signal key. Readonly
 * signal keys (computed / memo) unwrap to their value but get no setter —
 * the value is derived, so there is nothing valid to set. Non-signal values
 * are left unchanged.
 *
 * @example
 * type Store = { name: RefSignal<string>; upper: ReadonlyRefSignal<string>; sessionId: string }
 * type Unwrapped = UnwrappedStore<Store>
 * // {
 * //   name: string
 * //   upper: string
 * //   sessionId: string
 * //   setName: (value: string) => void
 * //   // no setUpper — readonly signals are not writable
 * // }
 */
export type UnwrappedStore<TStore> = {
  [K in keyof TStore]: TStore[K] extends ReadonlyRefSignal<infer V>
    ? V
    : TStore[K];
} & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TStore as TStore[K] extends RefSignal<any>
    ? `set${Capitalize<string & K>}`
    : never]: TStore[K] extends RefSignal<infer V> ? (value: V) => void : never;
};

export type StoreSnapshot<TStore> = {
  readonly [K in keyof TStore]: TStore[K] extends ReadonlyRefSignal<infer V>
    ? V
    : TStore[K];
};

type BaseStoreOptions<TStore> = TimingOptions & {
  filter?: (store: StoreSnapshot<TStore>) => boolean;
};

const IS_PRODUCTION =
  typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

// Dev-warning dedupe — a component re-rendering at frame rate must not flood
// the console with the same diagnostic. Keyed globally; good enough for dev.
const warnedRenderOnKeys = new Set<PropertyKey>();

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
 * @see [Decision Tree §8 — Context / Shared State](https://github.com/jav974/react-refsignal/blob/main/docs/decision-tree.md#8-context--shared-state)
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
 * // No re-renders — read imperatively (game loops, frame callbacks)
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
  // TypeScript rejects `unwrap` without `renderOn` at compile time, but plain
  // JS callers reach here unchecked — and get values that never refresh in JSX.
  // The cast defeats the union narrowing that makes this state "impossible".
  const uncheckedOptions = options as
    | { unwrap?: boolean; renderOn?: unknown }
    | undefined;
  if (
    !IS_PRODUCTION &&
    uncheckedOptions?.unwrap &&
    uncheckedOptions.renderOn === undefined
  ) {
    console.warn(
      '[react-refsignal] unwrap: true without renderOn — unwrapped values never trigger a re-render, so JSX will show stale values. Add renderOn (e.g. renderOn: ALL).',
    );
  }

  // ── Resolve which signals to subscribe to ─────────────────────────────────
  let signals: RefSignal[];
  if (options?.renderOn === 'all') {
    signals = Object.values(store).filter(isRefSignal);
  } else if (options?.renderOn !== undefined) {
    // Same JS-caller gap as the unwrap guard above: TypeScript rejects keys
    // that aren't signals on the store, but a plain-JS typo reaches here —
    // and an unresolved key would crash the render-snapshot pass (reading
    // .lastUpdated on undefined). Filter non-signals out; warn in dev.
    signals = [];
    for (const key of options.renderOn) {
      const value = (store as Record<PropertyKey, unknown>)[key];
      if (isRefSignal(value)) {
        signals.push(value);
      } else if (!IS_PRODUCTION && !warnedRenderOnKeys.has(key)) {
        warnedRenderOnKeys.add(key);
        console.warn(
          `[react-refsignal] renderOn key "${String(key)}" does not resolve to a signal on the store — updates will never trigger a re-render. Check for a typo or a non-signal value.`,
        );
      }
    }
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
