import type { TimingOptions, WatchOptions } from '../timing';
import { StoreSnapshot } from '../context/createRefSignalContext';

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
};

export type BroadcastSignalOptions = WatchOptions & BroadcastCommonOptions;

export type BroadcastOptions<TStore> = TimingOptions &
  BroadcastCommonOptions & {
    /** Skip the outgoing broadcast when this returns `false`. Receives a snapshot of current signal values. Incoming updates are always applied. */
    filter?: (snapshot: StoreSnapshot<TStore>) => boolean;
  };
