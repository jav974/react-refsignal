import {
  createRefSignal,
  isRefSignal,
  setDevToolsAdapter,
  type DevToolsAdapter,
  type DevToolsEvent,
  type RefSignal,
} from '../refsignal';
import type { PulseRefSignal } from '../pulse';
import { currentEffect, popEffect, pushEffect } from './effect-stack';

export interface DevToolsConfig {
  /** Log signal updates to console (also includes stack traces in history). */
  logUpdates?: boolean;
  /** Max items in the update-history ring buffer (default 100). */
  maxHistory?: number;
  /** Max items in the bus event ring buffer (default 500). */
  maxEvents?: number;
}

export interface SignalUpdate {
  signalId: string;
  name?: string;
  timestamp: number;
  oldValue: unknown;
  newValue: unknown;
  triggeredBy?: string;
  stackTrace?: string;
}

export interface CascadeEdge {
  from: string;
  to: string;
  effectId: string;
  t: number;
  count: number;
}

export interface SignalEntry {
  id: string;
  name?: string;
  /** Store this signal belongs to — set by `registerStore`, groups the Signals panel. */
  store?: string;
  signal: RefSignal;
}

export interface PulseSample {
  fps: number;
  dt: number;
  t: number;
}

export interface PulseState {
  pulseId: string;
  tickCount: number;
  elapsedMs: number;
  recent: PulseSample[];
  state: 'active' | 'paused' | 'stopped';
}

export interface BroadcastPeer {
  id: string;
  lastSeen: number;
}

export interface BroadcastChannelState {
  channel: string;
  mode?: string;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  gracePeriod?: number;
  isBroadcaster: boolean;
  isStable: boolean;
  peerCount: number;
  peers: BroadcastPeer[];
  lastUpdatedAt: number;
}

class RefSignalDevTools implements DevToolsAdapter {
  private config: DevToolsConfig = {
    logUpdates: false,
    maxHistory: 100,
    maxEvents: 500,
  };

  private signals = new WeakMap<object, string>();
  private signalsByName = new Map<string, RefSignal>();
  private signalEntries = new Map<string, SignalEntry>();
  private signalIdCounter = 0;
  private storeNames = new Set<string>();
  private storeIdCounter = 0;
  private updateHistory: SignalUpdate[] = [];
  private events: DevToolsEvent[] = [];
  private edges = new Map<string, CascadeEdge>();
  private internalSignals = new WeakSet();
  private skippedEffects = new Set<string>();
  /** Last 60 pulse:tick samples per pulse signal — kept out of the unified
   * ring so high-frequency ticks don't crowd out other events. */
  private pulses = new Map<string, PulseState>();
  /** Max samples retained per pulse — enough for a sparkline at 60Hz × 1s. */
  private maxPulseSamples = 60;
  /** Per-signal throttle for `trackNotify` — `.notify()` is the hot-path API
   * (rAF loops mutate `.current` + notify, sometimes 1000s/sec per signal).
   * Without this, a single skeleton-style demo would saturate the ring in
   * under a second. */
  private lastTouchEmitMs = new WeakMap<object, number>();
  private touchThrottleMs = 100;
  /** Per-channel broadcast state. Kept outside the unified ring so that
   * sparse transition events can't be evicted by a busy app — the panel
   * reads current state from here every render. */
  private broadcastChannels = new Map<string, BroadcastChannelState>();

  /**
   * Version counter — panels subscribe to this and re-read from `getEvents()`
   * / `getAllSignals()` / `getCascadeEdges()` when it changes. Pattern from
   * `feedback_hot_path_inplace_mutate_notify`: keep allocations off the hot
   * path by mutating internal arrays and bumping a primitive signal.
   *
   * Marked internal so panel subscriptions (which depend on it) are not
   * treated as effects — that would feed `trackEffectStart/End` emits back
   * into the bus and recurse forever.
   */
  readonly bus = createRefSignal(0);

  constructor() {
    this.internalSignals.add(this.bus as object);
  }

  /**
   * Mark a signal as devtools-owned plumbing — it stays out of the user-facing
   * registry, doesn't show up in panels, and effects whose deps include it
   * are not tracked for cascade attribution.
   */
  markInternal<T>(signal: RefSignal<T>): void {
    this.internalSignals.add(signal as object);
    const existing = this.signals.get(signal as object);
    if (existing !== undefined) {
      this.signals.delete(signal as object);
      this.signalEntries.delete(existing);
    }
  }

  /** Create a signal that is pre-marked internal — convenience for overlay state. */
  createInternal<T>(
    initialValue: T,
  ): RefSignal<T> & { readonly dispose: () => void } {
    const s = createRefSignal(initialValue);
    this.markInternal(s);
    return s;
  }

  configure(config: Partial<DevToolsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  registerSignal<T>(signal: RefSignal<T>, name?: string): () => void {
    if (this.internalSignals.has(signal as object)) {
      return () => {
        /* internal — not registered */
      };
    }
    const id = name ?? `signal_${String(this.signalIdCounter++)}`;
    this.signals.set(signal as object, id);
    if (name) {
      this.signalsByName.set(name, signal as RefSignal);
    }
    this.signalEntries.set(id, {
      id,
      name,
      signal: signal as RefSignal,
    });
    this.emit({ kind: 'signal:register', id, name, t: Date.now() });

    return () => {
      if (name) this.signalsByName.delete(name);
      this.signals.delete(signal as object);
      this.signalEntries.delete(id);
      this.emit({ kind: 'signal:dispose', id, t: Date.now() });
    };
  }

  getSignalName<T>(signal: RefSignal<T>): string | undefined {
    return this.signals.get(signal as object);
  }

  /**
   * Group a store's member signals under one name. Called by
   * `createRefSignalStore` after the factory runs — core only reports the
   * fact; all naming policy lives here:
   * - anonymous members are renamed `storeName.key` (registry id, timeline,
   *   cascade edges, and `getSignalByName` all pick the new name up)
   * - explicitly named members keep their name and only gain membership
   * - unnamed stores are auto-named `store_N`; name collisions get `#N`
   */
  registerStore(store: object, name?: string): void {
    let storeName = name ?? `store_${String(this.storeIdCounter++)}`;
    if (this.storeNames.has(storeName)) {
      let n = 2;
      while (this.storeNames.has(`${storeName}#${String(n)}`)) n++;
      storeName = `${storeName}#${String(n)}`;
    }
    this.storeNames.add(storeName);

    const members: string[] = [];
    for (const [key, value] of Object.entries(store)) {
      if (!isRefSignal(value) || this.internalSignals.has(value)) continue;
      const existingId = this.signals.get(value);
      const existingEntry =
        existingId !== undefined
          ? this.signalEntries.get(existingId)
          : undefined;

      if (existingEntry?.name) {
        // Explicit debug name wins — tag membership only.
        existingEntry.store = storeName;
        members.push(existingEntry.id);
        continue;
      }

      // Anonymous (or somehow unregistered) — adopt the derived name.
      const id = `${storeName}.${key}`;
      if (existingId !== undefined) this.signalEntries.delete(existingId);
      this.signals.set(value, id);
      this.signalsByName.set(id, value);
      this.signalEntries.set(id, {
        id,
        name: id,
        store: storeName,
        signal: value,
      });
      members.push(id);
    }

    this.emit({
      kind: 'store:register',
      store: storeName,
      members,
      t: Date.now(),
    });
  }

  trackUpdate<T>(signal: RefSignal<T>, oldValue: T, newValue: T): void {
    // Devtools-internal signals (bus, overlay state) bypass tracking — their
    // updates would feed back through the bus and recurse forever, and they
    // would also pollute user-facing panels.
    if (this.internalSignals.has(signal as object)) return;
    const id = this.signals.get(signal as object) ?? 'unknown';
    const triggered = currentEffect();
    const triggeredBy = triggered?.effectId;

    const record: SignalUpdate = {
      signalId: id,
      name: id,
      timestamp: Date.now(),
      oldValue,
      newValue,
      triggeredBy,
      stackTrace: this.config.logUpdates ? new Error().stack : undefined,
    };
    this.updateHistory.push(record);
    if (this.updateHistory.length > (this.config.maxHistory ?? 100)) {
      this.updateHistory.shift();
    }

    if (this.config.logUpdates) {
      console.log(`[RefSignal] ${id} updated:`, {
        from: oldValue,
        to: newValue,
      });
    }

    if (triggered) {
      const now = Date.now();
      for (const dep of triggered.depSignals) {
        const depId = this.signals.get(dep as object);
        if (depId && depId !== id) {
          const key = `${depId}->${id}`;
          const existing = this.edges.get(key);
          if (existing) {
            existing.count++;
            existing.t = now;
          } else {
            this.edges.set(key, {
              from: depId,
              to: id,
              effectId: triggered.effectId,
              t: now,
              count: 1,
            });
          }
        }
      }
    }

    this.emit({
      kind: 'signal:update',
      id,
      oldValue,
      newValue,
      triggeredBy,
      t: Date.now(),
    });
  }

  trackEffectStart(effectId: string, depSignals: readonly RefSignal[]): void {
    // Effects whose deps include devtools-internal signals (e.g. panel
    // subscriptions to the bus) are pure UI subscriptions, not user effects.
    // Skip both the cascade stack push and the bus emit, otherwise they would
    // recurse: emit → bus update → panel listener → trackEffectStart → emit …
    for (const d of depSignals) {
      if (this.internalSignals.has(d as object)) {
        this.skippedEffects.add(effectId);
        return;
      }
    }
    pushEffect({ effectId, depSignals });
    this.emit({
      kind: 'effect:start',
      effectId,
      depIds: depSignals.map((s) => this.signals.get(s as object) ?? 'unknown'),
      t: Date.now(),
    });
  }

  trackEffectEnd(effectId: string): void {
    if (this.skippedEffects.delete(effectId)) return;
    popEffect(effectId);
    this.emit({ kind: 'effect:end', effectId, t: Date.now() });
  }

  trackNotify<T>(signal: RefSignal<T>): void {
    // Skip internal devtools signals (bus, overlay state). Their own
    // `.notifyUpdate()` arrow would recurse through here forever otherwise.
    if (this.internalSignals.has(signal as object)) return;

    // Bus bump is unconditional for user signals — SignalsPanel re-renders
    // show fresh values even when the timeline-event branch below throttles.
    this.bus.current = this.bus.current + 1;
    this.bus.notifyUpdate();

    const now = Date.now();
    const last = this.lastTouchEmitMs.get(signal as object) ?? 0;
    if (now - last < this.touchThrottleMs) return;
    this.lastTouchEmitMs.set(signal as object, now);

    const id = this.signals.get(signal as object) ?? 'unknown';
    // Push the event directly (skip `emit()` so the bus has already been
    // bumped exactly once for this notify, regardless of throttle outcome).
    this.events.push({
      kind: 'signal:touch',
      id,
      value: signal.current,
      t: now,
    });
    if (this.events.length > (this.config.maxEvents ?? 500)) {
      this.events.shift();
    }
  }

  emit(event: DevToolsEvent): void {
    // High-frequency or stateful kinds are routed off the unified ring:
    // - `pulse:tick`: ~60Hz per pulse — would crowd out everything.
    // - `broadcast:peers`: stateful (carries current channel state). Panels
    //   need this every render, but it's sparse in many-to-many (one event
    //   ever) so it can't ride the ring's eviction policy.
    if (event.kind === 'pulse:tick') {
      this.recordPulseTick(event);
    } else if (event.kind === 'pulse:state') {
      this.recordPulseState(event);
    } else if (event.kind === 'broadcast:peers') {
      this.recordBroadcastChannel(event);
    } else {
      this.events.push(event);
      if (this.events.length > (this.config.maxEvents ?? 500)) {
        this.events.shift();
      }
    }
    // Mutate + notifyUpdate bypasses `update()`, which would re-enter
    // trackUpdate → emit → bus.update → ... and recurse infinitely.
    this.bus.current = this.bus.current + 1;
    this.bus.notifyUpdate();
  }

  private recordPulseTick(event: DevToolsEvent): void {
    const sig = event.signal as RefSignal | undefined;
    const id = sig ? (this.signals.get(sig as object) ?? 'pulse?') : 'pulse?';
    let state = this.pulses.get(id);
    if (!state) {
      state = {
        pulseId: id,
        tickCount: 0,
        elapsedMs: 0,
        recent: [],
        state: 'active',
      };
      this.pulses.set(id, state);
    }
    // A tick means the pulse is live again — clears a prior paused/stopped flag.
    state.state = 'active';
    state.tickCount =
      (event.tickCount as number | undefined) ?? state.tickCount;
    state.elapsedMs = (event.elapsed as number | undefined) ?? state.elapsedMs;
    state.recent.push({
      fps: event.fps as number,
      dt: event.dt as number,
      t: event.t,
    });
    if (state.recent.length > this.maxPulseSamples) {
      state.recent.shift();
    }
  }

  private recordPulseState(event: DevToolsEvent): void {
    const sig = event.signal as RefSignal | undefined;
    const id = sig ? (this.signals.get(sig as object) ?? 'pulse?') : 'pulse?';
    let state = this.pulses.get(id);
    if (!state) {
      state = {
        pulseId: id,
        tickCount: 0,
        elapsedMs: 0,
        recent: [],
        state: 'active',
      };
      this.pulses.set(id, state);
    }
    state.state =
      (event.state as PulseState['state'] | undefined) ?? state.state;
    state.tickCount =
      (event.tickCount as number | undefined) ?? state.tickCount;
    state.elapsedMs = (event.elapsed as number | undefined) ?? state.elapsedMs;
    // A stopped pulse cleared its session — drop the frozen sparkline so the
    // panel doesn't pair a stale trace with a 0/0 readout.
    if (state.state === 'stopped') {
      state.recent = [];
    }
  }

  getPulseStates(): PulseState[] {
    return Array.from(this.pulses.values()).map((p) => ({
      ...p,
      recent: p.recent.slice(),
    }));
  }

  /**
   * Resolve a pulse's imperative controls by id, for the overlay's
   * pause/resume/stop button. Reads the live signal from the dispose-cleaned
   * registry, so it returns undefined once the pulse is disposed and the
   * control hides itself — no strong ref is retained here.
   */
  getPulseControl(
    pulseId: string,
  ): Pick<PulseRefSignal, 'pause' | 'resume' | 'stop'> | undefined {
    const sig = this.signalEntries.get(pulseId)?.signal as
      | Partial<PulseRefSignal>
      | undefined;
    if (sig && typeof sig.pause === 'function') {
      return sig as Pick<PulseRefSignal, 'pause' | 'resume' | 'stop'>;
    }
    return undefined;
  }

  private recordBroadcastChannel(event: DevToolsEvent): void {
    const channel = event.channel as string | undefined;
    if (!channel) return;
    this.broadcastChannels.set(channel, {
      channel,
      mode: event.mode as string | undefined,
      heartbeatInterval: event.heartbeatInterval as number | undefined,
      heartbeatTimeout: event.heartbeatTimeout as number | undefined,
      gracePeriod: event.gracePeriod as number | undefined,
      isBroadcaster: (event.isBroadcaster as boolean | undefined) ?? false,
      isStable: (event.isStable as boolean | undefined) ?? false,
      peerCount: (event.count as number | undefined) ?? 0,
      peers: (event.peers as BroadcastPeer[] | undefined) ?? [],
      lastUpdatedAt: event.t,
    });
  }

  getBroadcastChannels(): BroadcastChannelState[] {
    return Array.from(this.broadcastChannels.values());
  }

  getUpdateHistory(): SignalUpdate[] {
    return [...this.updateHistory];
  }

  clearHistory(): void {
    this.updateHistory = [];
  }

  getEvents(): readonly DevToolsEvent[] {
    return this.events;
  }

  getCascadeEdges(): CascadeEdge[] {
    return Array.from(this.edges.values());
  }

  getSignalByName<T = unknown>(name: string): RefSignal<T> | undefined {
    return this.signalsByName.get(name) as RefSignal<T> | undefined;
  }

  getAllSignals(): SignalEntry[] {
    return Array.from(this.signalEntries.values());
  }

  reset(): void {
    this.updateHistory = [];
    this.events = [];
    this.signalsByName.clear();
    this.signalEntries.clear();
    this.edges.clear();
    this.pulses.clear();
    this.broadcastChannels.clear();
    this.signalIdCounter = 0;
    this.storeNames.clear();
    this.storeIdCounter = 0;
  }
}

export const devtools = new RefSignalDevTools();

export function configureDevTools(config: Partial<DevToolsConfig>): void {
  devtools.configure(config);
}

const isProd =
  typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

if (!isProd) {
  setDevToolsAdapter(devtools);
}

export type { DevToolsAdapter, DevToolsEvent };
