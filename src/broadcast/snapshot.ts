import { isRefSignal, RefSignal } from '../refsignal';

export function takeSnapshot(
  store: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(store)
      .filter(([, v]) => isRefSignal(v))
      .map(([k, v]) => [k, (v as RefSignal).current]),
  );
}

export function applySnapshot(
  store: Record<string, unknown>,
  data: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(data)) {
    const signal = store[k];
    if (isRefSignal(signal)) signal.update(v);
  }
}
