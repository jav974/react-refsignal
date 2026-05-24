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
   * Called when this tab's *stable* broadcaster state changes (`mode: 'one-to-many'` only).
   * Fires with `true` once this tab has been broadcaster for `gracePeriod` ms — or
   * synchronously if `gracePeriod` is unset or this tab is alone at election time.
   * Fires with `false` synchronously when this tab loses broadcaster status.
   */
  onStableBroadcasterChange?: (active: boolean) => void;
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
   * Opt-in grace period in ms for leadership transitions. `mode: 'one-to-many'` only.
   *
   * When set, two behaviors activate:
   *
   * - **Trailing-emit window.** A former broadcaster retains emit privileges for
   *   `gracePeriod` ms after losing leadership. In-flight work from when this tab
   *   was leader can still propagate to other tabs instead of being silently dropped.
   *
   * - **Delayed `isStableBroadcaster`.** A new broadcaster's `isStableBroadcaster`
   *   signal flips `true` only after `gracePeriod` ms have elapsed since gaining
   *   leadership — *unless* this tab is alone (no observed peers at election time),
   *   in which case the flip is synchronous (no useless wait on single-tab loads).
   *
   * Use to gate work that shouldn't fire during election ambiguity — e.g., RTK
   * Query's `skip: !isStableBroadcaster.current` prevents the new leader from
   * firing a fresh request the instant after election when the former leader's
   * trailing data might still be in flight.
   */
  gracePeriod?: number;
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
