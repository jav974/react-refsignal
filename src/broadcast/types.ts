import type { TimingOptions, WatchOptions } from '../timing';
import type { StoreSnapshot } from '../store/useRefSignalStore';

export type BroadcastMode = 'many-to-many' | 'one-to-many';

type BroadcastCommonOptions = {
  /** Channel name — all tabs using the same channel share state. */
  channel: string;
  /** `'many-to-many'` (default) — any tab broadcasts. `'one-to-many'` — only the elected tab broadcasts. */
  mode?: BroadcastMode;
  /** Called when this tab gains or loses broadcaster status (`mode: 'one-to-many'` only). */
  onBroadcasterChange?: (active: boolean) => void;
  /** How often to send a heartbeat, in ms. `mode: 'one-to-many'` only. Default: 2000. */
  heartbeatInterval?: number;
  /** Consider a tab dead after this many ms of silence. `mode: 'one-to-many'` only. Default: 5000. */
  heartbeatTimeout?: number;
  /**
   * Delay in ms before running the first election after setup or visibility-resume.
   * `mode: 'one-to-many'` only. Default: 50.
   *
   * The delay gives peers a brief window to respond to our initial `hello`.
   * Without it, a tab joining an existing session transiently self-elects
   * before the peers' hellos arrive, producing a visible flicker of
   * `isBroadcaster` from `false → true → false`.
   *
   * - Set to `0` to elect synchronously (lone-tab scenarios; fastest).
   * - Values ≥ `heartbeatInterval` have no effect — the periodic tick runs first.
   */
  initialElectionDelay?: number;
};

export type BroadcastSignalOptions = WatchOptions & BroadcastCommonOptions;

export type BroadcastOptions<TStore> = TimingOptions &
  BroadcastCommonOptions & {
    /** Skip the outgoing broadcast when this returns `false`. Receives a snapshot of current signal values. Incoming updates are always applied. */
    filter?: (snapshot: StoreSnapshot<TStore>) => boolean;
  };
