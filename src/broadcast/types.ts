import type { TimingOptions } from '../timing';
import { StoreSnapshot } from '../context/createRefSignalContext';

export type BroadcastMode = 'many-to-many' | 'one-to-many';

export type BroadcastSignalOptions = TimingOptions & {
  /** Channel name — all tabs using the same channel share this signal's value. */
  channel: string;
  /** `'many-to-many'` (default) — any tab broadcasts. `'one-to-many'` — only the elected tab broadcasts. */
  mode?: BroadcastMode;
  /** Skip the outgoing broadcast when this returns `false`. Incoming updates are always applied. */
  filter?: () => boolean;
  /** Called when this tab gains or loses broadcaster status (`mode: 'one-to-many'` only). */
  onBroadcasterChange?: (active: boolean) => void;
  /** How often to send a heartbeat, in ms. `mode: 'one-to-many'` only. Default: 2000. */
  heartbeatInterval?: number;
  /** Consider a tab dead after this many ms of silence. `mode: 'one-to-many'` only. Default: 5000. */
  heartbeatTimeout?: number;
};

export type BroadcastOptions<TStore> = TimingOptions & {
  /** Channel name — all tabs using the same name share state. */
  channel: string;
  /** `'many-to-many'` (default) — any tab broadcasts. `'one-to-many'` — only the elected tab broadcasts. */
  mode?: BroadcastMode;
  /** Skip the outgoing broadcast when this returns `false`. Incoming updates are always applied. */
  filter?: (snapshot: StoreSnapshot<TStore>) => boolean;
  /** Called when this tab gains or loses broadcaster status (`mode: 'one-to-many'` only). */
  onBroadcasterChange?: (active: boolean) => void;
  /** How often to send a heartbeat, in ms. `mode: 'one-to-many'` only. Default: 5000. */
  heartbeatInterval?: number;
  /** Consider a tab dead after this many ms of silence. `mode: 'one-to-many'` only. Default: 5000. */
  heartbeatTimeout?: number;
};
