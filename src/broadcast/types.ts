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
  /**
   * How often each tab announces presence with a `hello` heartbeat, in ms.
   * `mode: 'one-to-many'` only. Default: 300.
   *
   * Every tab sends heartbeats — the election picks the lowest-ID tab among
   * those currently heard. Lower values mean faster failover when a tab
   * disappears and shorter `initialElectionDelay` for new joiners, at the
   * cost of more channel chatter. The default of 300ms is cheap on a local
   * `BroadcastChannel`.
   */
  heartbeatInterval?: number;
  /** Consider a tab dead after this many ms of silence. `mode: 'one-to-many'` only. Default: 5000. */
  heartbeatTimeout?: number;
  /**
   * Delay in ms before running the first election after setup or visibility-resume.
   * `mode: 'one-to-many'` only. Default: 400.
   *
   * The delay gives existing peers a window to respond to our initial `hello`
   * with their own heartbeats. Without it, a tab joining an existing session
   * transiently self-elects before any peer heartbeats arrive, producing a
   * visible flicker of `isBroadcaster` from `false → true → false`.
   *
   * **Should be ≥ `heartbeatInterval`** — the joiner must wait at least one
   * heartbeat cycle to be sure of hearing every existing peer. If you raise
   * `heartbeatInterval`, raise this in step.
   *
   * - Set to `0` to elect synchronously (lone-tab scenarios; fastest, accepts the flicker).
   * - Values ≥ `heartbeatInterval` are the safe range; smaller values risk the flicker described above.
   */
  initialElectionDelay?: number;
};

export type BroadcastSignalOptions = WatchOptions & BroadcastCommonOptions;

export type BroadcastOptions<TStore> = TimingOptions &
  BroadcastCommonOptions & {
    /** Skip the outgoing broadcast when this returns `false`. Receives a snapshot of current signal values. Incoming updates are always applied. */
    filter?: (snapshot: StoreSnapshot<TStore>) => boolean;
  };
