/**
 * Creates a module-scope signal store singleton.
 *
 * Calls `factory()` once immediately — the returned store lives for the
 * application's lifetime. Use {@link useRefSignalStore} to connect the store
 * to React components with opt-in re-renders, timing, and value unwrapping.
 *
 * Signals in the store are accessible directly outside React — no Provider,
 * no hook required for imperative reads and writes.
 *
 * Composes with `persist()` and `broadcast()` — wrap the factory before
 * passing it in. Setup runs at store creation time (not inside a Provider).
 *
 * When you need per-subtree isolation (separate store per Provider mount),
 * use {@link createRefSignalContext} instead.
 *
 * @example
 * import { createRefSignalStore, useRefSignalStore } from 'react-refsignal';
 *
 * const gameStore = createRefSignalStore(() => ({
 *   score: createRefSignal(0),
 *   level: createRefSignal(1),
 * }));
 *
 * // Outside React — direct access
 * gameStore.score.update(42);
 *
 * // In a component — opt into re-renders explicitly
 * function ScoreDisplay() {
 *   const store = useRefSignalStore(gameStore, { renderOn: ['score'] });
 *   return <div>{store.score.current}</div>;
 * }
 *
 * @example
 * // With persist — no Provider needed
 * import { persist } from 'react-refsignal/persist';
 *
 * const gameStore = createRefSignalStore(
 *   persist(() => ({ score: createRefSignal(0) }), { key: 'game' }),
 * );
 */
export function createRefSignalStore<TStore extends Record<string, unknown>>(
  factory: () => TStore,
): TStore {
  return factory();
}
