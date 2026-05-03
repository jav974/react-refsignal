export * from './hooks/useRefSignal';
export * from './hooks/useRefSignalEffect';
export * from './hooks/useRefSignalMemo';
export * from './hooks/useRefSignalRender';
export * from './hooks/useRefSignalFollow';
export type {
  Listener,
  RefSignal,
  ReadonlyRefSignal,
  SignalOptions,
  Interceptor,
  DevToolsAdapter,
  SignalBroadcastInput,
  SignalPersistInput,
} from './refsignal';
// Deprecated type aliases re-exported for backward compatibility.
export type {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  ReadonlySignal,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  ComputedSignal,
} from './refsignal';
export {
  batch,
  createRefSignal,
  isRefSignal,
  CANCEL,
  createComputedRefSignal,
  watch,
} from './refsignal';
// Deprecated factory re-exported for backward compatibility.
export {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  createComputedSignal,
} from './refsignal';
export {
  createRefSignalContext,
  createRefSignalContextHook,
  ALL,
} from './context/createRefSignalContext';
export type {
  RefSignalContextType,
  ContextHook,
} from './context/createRefSignalContext';
export { createRefSignalStore } from './store/createRefSignalStore';
export { useRefSignalStore } from './store/useRefSignalStore';
export type {
  RefSignalKeys,
  UnwrappedStore,
  StoreSnapshot,
  SignalStoreOptions,
  SignalStoreOptionsPlain,
  SignalStoreOptionsUnwrapped,
} from './store/useRefSignalStore';
export type { EffectOptions } from './hooks/useRefSignalEffect';
export type { TimingOptions, WatchOptions } from './timing';
export { watchSignals } from './watchSignals';
export type { WatchHandle } from './watchSignals';
