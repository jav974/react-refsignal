import { batch, isRefSignal, RefSignal } from '../refsignal';

export function takeSnapshot(store: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(store)
      .filter(([, v]) => isRefSignal(v))
      .map(([k, v]) => [k, (v as RefSignal).current]),
  );
}

export function applySnapshot(
  store: object,
  data: Record<string, unknown>,
): void {
  // Batch so subscribers (including the broadcast listener itself) see all
  // updated signals together at the batch-commit. Without this, each
  // per-signal .update() would re-fire a fresh outgoing snapshot containing
  // still-un-updated siblings — a partial-state echo loop between tabs.
  batch(() => {
    for (const [k, v] of Object.entries(data)) {
      const signal = (store as Record<string, unknown>)[k];
      if (isRefSignal(signal)) signal.update(v);
    }
  });
}
