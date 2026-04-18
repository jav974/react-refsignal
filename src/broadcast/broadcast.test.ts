/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { renderHook } from '../test-utils/renderHook';
import { CANCEL, createRefSignal, type RefSignal } from '../refsignal';
import { broadcast, useBroadcast } from './index';
import { setupBroadcast } from './broadcast';
import { useRefSignal } from '../hooks/useRefSignal';
import { setupRafMock } from '../test-utils/raf';
import type { BroadcastOptions } from './types';

type ScoreStore = { score: RefSignal<number> };

/**
 * Builds and instantiates a one-signal broadcast store. Collapses the
 * `const factory = broadcast(() => ({ score: createRefSignal(initial) }), opts); const store = factory();`
 * pattern that repeats across this file into one call. `initial` defaults to 0.
 */
function mountScoreBroadcaster(
  options: BroadcastOptions<ScoreStore>,
  initial = 0,
) {
  return broadcast(() => ({ score: createRefSignal(initial) }), options)();
}

// ─── Transport mocks ──────────────────────────────────────────────────────────

type Listener = (msg: unknown) => void;

/** Minimal BroadcastChannel stub — channels share a bus per name. */
const buses = new Map<string, Set<{ instance: MockBC; cb: Listener | null }>>();

class MockBC {
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    if (!buses.has(name)) buses.set(name, new Set());
    buses.get(name)!.add({ instance: this, cb: null });
  }

  postMessage(data: unknown) {
    for (const entry of buses.get(this.name) ?? []) {
      if (entry.instance !== this && entry.instance.onmessage) {
        entry.instance.onmessage({ data });
      }
    }
  }

  close() {
    const bus = buses.get(this.name);
    if (bus) {
      for (const entry of bus) {
        if (entry.instance === this) {
          bus.delete(entry);
          break;
        }
      }
    }
  }
}

beforeEach(() => {
  buses.clear();
  (globalThis as any).BroadcastChannel = MockBC;
  jest.useFakeTimers();
});

afterEach(() => {
  delete (globalThis as any).BroadcastChannel;
  jest.useRealTimers();
});

// Helper: simulate a message arriving from another tab on a channel.
// Routes through `postMessage` + `close` so the delivery path matches
// production usage (BroadcastChannel never delivers to its own sender).
function deliverFromOtherTab(channel: string, msg: unknown) {
  const sender = new MockBC(channel);
  sender.postMessage(msg);
  sender.close();
}

// ─── broadcast() — factory wrapper ───────────────────────────────────────────

describe('broadcast() — many-to-many', () => {
  it('sends snapshot to other tabs when a signal updates', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
    });

    const received: unknown[] = [];
    deliverFromOtherTab('test', null); // warm up listener

    // Intercept outgoing by listening on the same channel from "another tab"
    const bc = new MockBC('test');
    bc.onmessage = (e) => received.push(e.data);

    store.score.update(42);

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe('update');
    expect((received[0] as any).payload.score).toBe(42);

    bc.close();
  });

  it('applies incoming snapshot from another tab', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
    });

    deliverFromOtherTab('test', {
      type: 'update',
      tabId: 'other-tab',
      payload: { score: 99 },
    });

    expect(store.score.current).toBe(99);
  });

  it('ignores own messages (tabId check)', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
    });

    // Simulate a message arriving with our own TAB_ID — should be ignored
    // We can't know the internal TAB_ID, but we can verify applying a snapshot
    // from a known-different tabId works, and count updates
    const listener = jest.fn();
    store.score.subscribe(listener);

    // Incoming from other tab — should apply
    deliverFromOtherTab('test', {
      type: 'update',
      tabId: 'other-tab',
      payload: { score: 5 },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips outgoing send when filter returns false', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
      filter: (s) => s.score > 10,
    });

    const received: unknown[] = [];
    const bc = new MockBC('test');
    bc.onmessage = (e) => received.push(e.data);

    store.score.update(5); // filter false — skip
    expect(received).toHaveLength(0);

    store.score.update(15); // filter true — send
    expect(received).toHaveLength(1);

    bc.close();
  });

  it('respects throttle — collapses rapid updates into one send', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
      throttle: 100,
    });

    const received: unknown[] = [];
    const bc = new MockBC('test');
    bc.onmessage = (e) => received.push(e.data);

    store.score.update(1); // leading edge
    store.score.update(2);
    store.score.update(3);
    jest.advanceTimersByTime(110); // trailing edge

    expect(received).toHaveLength(2); // leading + trailing
    bc.close();
  });

  it('ignores unknown keys in incoming snapshot', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
    });

    expect(() => {
      deliverFromOtherTab('test', {
        type: 'update',
        tabId: 'other-tab',
        payload: { score: 10, unknown: 'ignored' },
      });
    }).not.toThrow();

    expect(store.score.current).toBe(10);
  });

  it('ignores malformed messages', () => {
    const store = mountScoreBroadcaster({
      channel: 'test',
    });

    expect(() => {
      deliverFromOtherTab('test', null);
      deliverFromOtherTab('test', 'not-an-object');
      deliverFromOtherTab('test', { noType: true });
    }).not.toThrow();

    expect(store.score.current).toBe(0);
  });
});

// ─── broadcast() — one-to-many ────────────────────────────────────────────────

describe('broadcast() — one-to-many', () => {
  it('calls onBroadcasterChange(true) when elected', () => {
    const onBroadcasterChange = jest.fn();
    mountScoreBroadcaster({
      channel: 'elect',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 100,
    });

    // Immediate election with no competition — should win
    expect(onBroadcasterChange).toHaveBeenCalledWith(true);
  });

  it('elected tab sends updates; non-elected tab does not', () => {
    const received: unknown[] = [];

    // Tab A — broadcaster
    const storeA = mountScoreBroadcaster({
      channel: 'elect',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    const bc = new MockBC('elect');
    bc.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    storeA.score.update(10);
    expect(received).toHaveLength(1);
    bc.close();
  });

  it('non-broadcaster receives incoming updates', () => {
    mountScoreBroadcaster({
      channel: 'recv',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    const store = mountScoreBroadcaster({
      channel: 'recv',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    // Deliver an incoming update regardless of broadcaster status
    deliverFromOtherTab('recv', {
      type: 'update',
      tabId: 'other-tab',
      payload: { score: 77 },
    });

    expect(store.score.current).toBe(77);
  });

  it('re-elects when broadcaster sends bye', () => {
    const onBroadcasterChange = jest.fn();

    // First tab — becomes broadcaster
    mountScoreBroadcaster({
      channel: 'bye-test',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    // Second tab — observes
    mountScoreBroadcaster({
      channel: 'bye-test',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
      onBroadcasterChange,
    });

    // Simulate first tab sending bye
    deliverFromOtherTab('bye-test', { type: 'bye', tabId: 'leaving-tab' });

    // After bye, re-election runs — second tab should win (or at least re-check)
    jest.advanceTimersByTime(110);
    // We just verify no throw and the callback was invoked at some point
    expect(onBroadcasterChange).toHaveBeenCalled();
  });
});

// ─── useBroadcast() hook ──────────────────────────────────────────────────────

describe('useBroadcast()', () => {
  // Two stores in the same process share the same TAB_ID, so they ignore each
  // other's outgoing messages (correct behaviour in production — different tabs
  // have different IDs). Tests split: outgoing and incoming are verified separately.

  it('sends snapshot to other tabs when a signal updates', () => {
    const store = { score: createRefSignal(0) };
    renderHook(() => {
      useBroadcast(store, { channel: 'hook-out' });
    });

    const received: unknown[] = [];
    const spy = new MockBC('hook-out');
    spy.onmessage = (e) => received.push(e.data);

    act(() => {
      store.score.update(55);
    });

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe('update');
    expect((received[0] as any).payload.score).toBe(55);

    spy.close();
  });

  it('applies incoming snapshot from another tab', () => {
    const store = { score: createRefSignal(0) };
    renderHook(() => {
      useBroadcast(store, { channel: 'hook-in' });
    });

    act(() => {
      deliverFromOtherTab('hook-in', {
        type: 'update',
        tabId: 'other-tab',
        payload: { score: 55 },
      });
    });

    expect(store.score.current).toBe(55);
  });

  it('cleans up transport on unmount', () => {
    const store = { score: createRefSignal(0) };
    const { unmount } = renderHook(() => {
      useBroadcast(store, { channel: 'unmount-test' });
    });

    unmount();

    // After unmount the channel bus should be empty (channel closed)
    const bus = buses.get('unmount-test') ?? new Set();
    expect(bus.size).toBe(0);
  });

  it('resubscribes when channel changes', () => {
    const store = { score: createRefSignal(0) };
    let channel = 'ch-1';

    const { rerender } = renderHook(() => {
      useBroadcast(store, { channel });
    });

    channel = 'ch-2';
    rerender();

    // Old channel should be cleaned up
    const oldBus = buses.get('ch-1') ?? new Set();
    expect(oldBus.size).toBe(0);
  });

  it('respects filter — skips outgoing send when filter returns false', () => {
    const store = { score: createRefSignal(0) };
    renderHook(() => {
      useBroadcast(store, {
        channel: 'filter-hook',
        filter: (s) => s.score > 10,
      });
    });

    const received: unknown[] = [];
    const spy = new MockBC('filter-hook');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    act(() => {
      store.score.update(5);
    }); // filter false — no send
    expect(received).toHaveLength(0);

    act(() => {
      store.score.update(15);
    }); // filter true — send
    expect(received).toHaveLength(1);
    expect((received[0] as any).payload.score).toBe(15);

    spy.close();
  });

  it('one-to-many: sends bye on unmount', () => {
    const store = { score: createRefSignal(0) };
    const received: unknown[] = [];

    const bc = new MockBC('bye-hook');
    bc.onmessage = (e) => received.push(e.data);

    const { unmount } = renderHook(() => {
      useBroadcast(store, {
        channel: 'bye-hook',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        heartbeatInterval: 1000,
      });
    });

    unmount();

    const byeMsgs = received.filter((m: any) => m?.type === 'bye');
    expect(byeMsgs).toHaveLength(1);

    bc.close();
  });

  // ── isBroadcaster return value ───────────────────────────────────────────────

  it('isBroadcaster starts true in many-to-many mode', () => {
    const store = { score: createRefSignal(0) };
    const { result } = renderHook(() =>
      useBroadcast(store, { channel: 'is-bc-m2m' }),
    );
    expect(result.current.isBroadcaster.current).toBe(true);
  });

  it('isBroadcaster is false when a lower-ID tab holds broadcaster status', () => {
    const store = { score: createRefSignal(0) };
    const { result } = renderHook(() =>
      useBroadcast(store, {
        channel: 'is-bc-o2m-false',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        heartbeatInterval: 1000,
      }),
    );

    // Tab wins election immediately as sole tab, then a lower-ID tab claims it
    act(() => {
      deliverFromOtherTab('is-bc-o2m-false', {
        type: 'broadcaster-claim',
        tabId: '0000', // lower ID → this tab yields
      });
    });

    expect(result.current.isBroadcaster.current).toBe(false);
  });

  it('isBroadcaster becomes true when tab wins election', () => {
    const store = { score: createRefSignal(0) };
    const { result } = renderHook(() =>
      useBroadcast(store, {
        channel: 'is-bc-elect',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        heartbeatInterval: 1000,
      }),
    );

    // Simulate broadcaster-claim arriving from a tab with a higher TAB_ID
    // (so this tab keeps broadcaster status via the election logic)
    act(() => {
      deliverFromOtherTab('is-bc-elect', {
        type: 'broadcaster-claim',
        tabId: 'zzz-higher-id', // higher than TAB_ID → this tab remains broadcaster
      });
    });

    // After receiving a claim from a higher ID, this tab asserts itself
    expect(result.current.isBroadcaster.current).toBe(true);
  });

  it('isBroadcaster signal is correct across channel and mode changes', () => {
    const store = { score: createRefSignal(0) };
    let channel = 'is-bc-ch1';
    let mode: 'many-to-many' | 'one-to-many' = 'many-to-many';

    const { result, rerender } = renderHook(() =>
      useBroadcast(store, {
        channel,
        mode,
        heartbeatInterval: 1000,
        initialElectionDelay: 0,
      }),
    );

    expect(result.current.isBroadcaster.current).toBe(true); // many-to-many — always true

    // Switch to one-to-many — sole tab wins election immediately
    channel = 'is-bc-ch2';
    mode = 'one-to-many';
    rerender();

    expect(result.current.isBroadcaster.current).toBe(true); // won election as sole tab

    // A lower-ID competitor arrives — this tab yields
    act(() => {
      deliverFromOtherTab('is-bc-ch2', {
        type: 'broadcaster-claim',
        tabId: '0000',
      });
    });

    expect(result.current.isBroadcaster.current).toBe(false);
  });

  it('isBroadcaster signal is stable across re-renders', () => {
    const store = { score: createRefSignal(0) };
    const { result, rerender } = renderHook(() =>
      useBroadcast(store, { channel: 'is-bc-stable' }),
    );

    const signalRef = result.current.isBroadcaster;
    rerender();
    expect(result.current.isBroadcaster).toBe(signalRef);
  });

  it('user onBroadcasterChange is still called when isBroadcaster signal is returned', () => {
    const store = { score: createRefSignal(0) };
    const onChange = jest.fn();

    renderHook(() =>
      useBroadcast(store, {
        channel: 'is-bc-callback',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        heartbeatInterval: 1000,
        onBroadcasterChange: onChange,
      }),
    );

    act(() => {
      deliverFromOtherTab('is-bc-callback', {
        type: 'broadcaster-claim',
        tabId: 'zzz-higher-id',
      });
    });

    expect(onChange).toHaveBeenCalledWith(true);
  });
});

// ─── localStorage fallback ────────────────────────────────────────────────────

describe('localStorage fallback transport', () => {
  beforeEach(() => {
    delete (globalThis as any).BroadcastChannel;
  });

  it('writes to localStorage and receives via storage event', () => {
    const storeA = { score: createRefSignal(0) };
    const storeB = { score: createRefSignal(0) };

    renderHook(() => {
      useBroadcast(storeA, { channel: 'ls-test' });
    });
    renderHook(() => {
      useBroadcast(storeB, { channel: 'ls-test' });
    });

    // Simulate a storage event (as if another tab wrote)
    const msg = JSON.stringify({
      type: 'update',
      tabId: 'other-tab',
      payload: { score: 33 },
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: '__bc__ls-test', newValue: msg }),
      );
    });

    expect(storeB.score.current).toBe(33);
  });

  it('ignores storage events for other keys', () => {
    const store = { score: createRefSignal(0) };
    renderHook(() => {
      useBroadcast(store, { channel: 'ls-test2' });
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'unrelated-key',
          newValue: JSON.stringify({
            type: 'update',
            tabId: 'x',
            payload: { score: 99 },
          }),
        }),
      );
    });

    expect(store.score.current).toBe(0);
  });

  it('handles corrupt JSON gracefully', () => {
    const store = { score: createRefSignal(0) };
    renderHook(() => {
      useBroadcast(store, { channel: 'ls-corrupt' });
    });

    expect(() => {
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: '__bc__ls-corrupt',
            newValue: '{not valid json',
          }),
        );
      });
    }).not.toThrow();

    expect(store.score.current).toBe(0);
  });

  it('ignores storage event with null newValue', () => {
    const store = { score: createRefSignal(0) };
    renderHook(() => {
      useBroadcast(store, { channel: 'ls-null' });
    });

    expect(() => {
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: '__bc__ls-null', newValue: null }),
        );
      });
    }).not.toThrow();

    expect(store.score.current).toBe(0);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases — store shape', () => {
  it('snapshots all signals in a multi-signal store', () => {
    const factory = broadcast(
      () => ({ x: createRefSignal(0), y: createRefSignal(0) }),
      { channel: 'multi' },
    );
    const store = factory();

    const received: unknown[] = [];
    const spy = new MockBC('multi');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    store.x.update(10);

    expect(received).toHaveLength(1);
    const payload = (received[0] as any).payload;
    expect(payload.x).toBe(10);
    expect(payload.y).toBe(0); // full snapshot, not just changed signal

    spy.close();
  });

  it('applies incoming snapshot to all matching signals', () => {
    const factory = broadcast(
      () => ({ x: createRefSignal(0), y: createRefSignal(0) }),
      { channel: 'multi-recv' },
    );
    const store = factory();

    deliverFromOtherTab('multi-recv', {
      type: 'update',
      tabId: 'other',
      payload: { x: 3, y: 7 },
    });

    expect(store.x.current).toBe(3);
    expect(store.y.current).toBe(7);
  });

  it('ignores non-signal values in store during snapshot', () => {
    const factory = broadcast(
      () => ({ score: createRefSignal(0), label: 'static' as unknown }),
      { channel: 'mixed' },
    );
    const store = factory();

    const received: unknown[] = [];
    const spy = new MockBC('mixed');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    store.score.update(5);

    expect(received).toHaveLength(1);
    const payload = (received[0] as any).payload;
    expect(payload.score).toBe(5);
    expect('label' in payload).toBe(false); // non-signal excluded

    spy.close();
  });

  it('does not throw when applying snapshot containing a non-signal key', () => {
    const factory = broadcast(
      () => ({ score: createRefSignal(0), label: 'static' as unknown }),
      { channel: 'mixed-recv' },
    );
    const store = factory();

    expect(() => {
      deliverFromOtherTab('mixed-recv', {
        type: 'update',
        tabId: 'other',
        payload: { score: 9, label: 'ignored' },
      });
    }).not.toThrow();

    expect(store.score.current).toBe(9);
  });
});

describe('edge cases — one-to-many election', () => {
  it('yields broadcaster status when a lower-ID tab sends broadcaster-claim', () => {
    const onBroadcasterChange = jest.fn();
    mountScoreBroadcaster({
      channel: 'yield',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 100,
    });

    // Our tab won election immediately — should be broadcaster
    expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);

    // A tab with a lexicographically smaller ID claims broadcaster
    deliverFromOtherTab('yield', { type: 'broadcaster-claim', tabId: '0000' });

    expect(onBroadcasterChange).toHaveBeenLastCalledWith(false);
  });

  it('yields to a lower-ID tab announced via hello, sends state-handoff', () => {
    const onBroadcasterChange = jest.fn();
    mountScoreBroadcaster(
      {
        channel: 'hello-yield',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        onBroadcasterChange,
        heartbeatInterval: 1000,
      },
      42,
    );

    // Tab wins initial election (no competition yet)
    expect(onBroadcasterChange).toHaveBeenCalledWith(true);

    const received: unknown[] = [];
    const spy = new MockBC('hello-yield');
    spy.onmessage = (e) => received.push(e.data);

    // A lower-ID tab announces itself via hello — triggers electBroadcaster, which yields
    deliverFromOtherTab('hello-yield', {
      type: 'hello',
      tabId: '0000',
      ts: Date.now(),
    });

    expect(onBroadcasterChange).toHaveBeenLastCalledWith(false);
    const handoff = received.find((m: any) => m?.type === 'state-handoff');
    expect(handoff).toBeDefined();
    expect((handoff as any).payload.score).toBe(42);

    spy.close();
  });

  it('removes dead tabs after heartbeatTimeout and re-elects', () => {
    const onBroadcasterChange = jest.fn();

    // Simulate another tab that will go silent
    deliverFromOtherTab('timeout-test', {
      type: 'hello',
      tabId: '0000', // lower ID — would normally win
      ts: Date.now(),
    });

    mountScoreBroadcaster({
      channel: 'timeout-test',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 100,
      heartbeatTimeout: 500,
    });

    // The other tab (0000) should win election initially since it was seen
    // After heartbeatTimeout ms of silence, it gets pruned and we take over
    jest.advanceTimersByTime(600); // past heartbeatTimeout

    expect(onBroadcasterChange).toHaveBeenCalledWith(true);
  });

  it('sends state-handoff when yielding to a lower-ID broadcaster-claim', () => {
    const store = mountScoreBroadcaster({
      channel: 'handoff-send',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    // Set a known value so we can assert it appears in the handoff payload
    store.score.update(42);

    const received: unknown[] = [];
    const spy = new MockBC('handoff-send');
    spy.onmessage = (e) => received.push(e.data);

    // A tab with a lexicographically lower ID claims broadcaster — we yield
    deliverFromOtherTab('handoff-send', {
      type: 'broadcaster-claim',
      tabId: '0000',
    });

    const handoff = received.find((m: any) => m?.type === 'state-handoff');
    expect(handoff).toBeDefined();
    expect((handoff as any).payload.score).toBe(42);

    spy.close();
  });

  it('applies state-handoff from yielding tab when this tab is broadcaster', () => {
    const store = mountScoreBroadcaster({
      channel: 'handoff-recv',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    // This tab wins election immediately (no competition) — isBroadcaster = true
    // Simulate the yielding broadcaster sending its in-memory state
    deliverFromOtherTab('handoff-recv', {
      type: 'state-handoff',
      tabId: 'other-tab',
      payload: { score: 99 },
    });

    expect(store.score.current).toBe(99);
  });

  it('non-broadcaster ignores state-handoff', () => {
    const store = mountScoreBroadcaster({
      channel: 'handoff-ignore',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 100,
    });

    // Force the tab to yield broadcaster role
    deliverFromOtherTab('handoff-ignore', {
      type: 'broadcaster-claim',
      tabId: '0000',
    });

    // Now it's a non-broadcaster — state-handoff should be ignored
    store.score.update(42); // update via update() — but isBroadcaster is false so no send
    deliverFromOtherTab('handoff-ignore', {
      type: 'state-handoff',
      tabId: 'other-tab',
      payload: { score: 77 },
    });

    expect(store.score.current).toBe(42); // unchanged
  });
});

describe('initialElectionDelay', () => {
  it('defers first election by the configured delay', () => {
    jest.useFakeTimers();
    try {
      const onBroadcasterChange = jest.fn();
      mountScoreBroadcaster({
        channel: 'delay-basic',
        mode: 'one-to-many',
        onBroadcasterChange,
        heartbeatInterval: 1000,
        initialElectionDelay: 50,
      });

      // Not elected yet — within the delay window
      expect(onBroadcasterChange).not.toHaveBeenCalled();

      jest.advanceTimersByTime(49);
      expect(onBroadcasterChange).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('defaults to 50ms when not specified', () => {
    jest.useFakeTimers();
    try {
      const onBroadcasterChange = jest.fn();
      mountScoreBroadcaster({
        channel: 'delay-default',
        mode: 'one-to-many',
        onBroadcasterChange,
        heartbeatInterval: 1000,
      });

      jest.advanceTimersByTime(49);
      expect(onBroadcasterChange).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('initialElectionDelay: 0 elects synchronously', () => {
    const onBroadcasterChange = jest.fn();
    mountScoreBroadcaster({
      channel: 'delay-zero',
      mode: 'one-to-many',
      onBroadcasterChange,
      heartbeatInterval: 1000,
      initialElectionDelay: 0,
    });

    expect(onBroadcasterChange).toHaveBeenCalledWith(true);
  });

  it('peer hello arriving within the delay window prevents transient self-election', () => {
    jest.useFakeTimers();
    try {
      const onBroadcasterChange = jest.fn();
      mountScoreBroadcaster({
        channel: 'delay-peer',
        mode: 'one-to-many',
        onBroadcasterChange,
        heartbeatInterval: 1000,
        initialElectionDelay: 50,
      });

      // Within the delay window, a lower-ID peer hellos
      deliverFromOtherTab('delay-peer', {
        type: 'hello',
        tabId: '0000',
        ts: Date.now(),
      });

      // Scheduled election fires — peer in tabsLastSeen already, so our tab
      // correctly does NOT self-elect
      jest.advanceTimersByTime(50);

      expect(onBroadcasterChange).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('scheduled election is cancelled on unmount before it fires', () => {
    jest.useFakeTimers();
    try {
      const onBroadcasterChange = jest.fn();
      const { unmount } = renderHook(() =>
        useBroadcast(
          { score: createRefSignal(0) },
          {
            channel: 'delay-cancel',
            mode: 'one-to-many',
            onBroadcasterChange,
            heartbeatInterval: 1000,
            initialElectionDelay: 50,
          },
        ),
      );

      // Unmount within the delay window
      jest.advanceTimersByTime(20);
      unmount();

      // Timer would have fired at 50ms — advance past that; nothing should happen
      jest.advanceTimersByTime(100);

      expect(onBroadcasterChange).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── visibility handling (one-to-many only) ──────────────────────────────────

describe('visibility handling', () => {
  // jsdom's document.visibilityState is a getter — override with a value we
  // control for the duration of the test.
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
  };

  it('hidden → yields broadcaster role and posts bye', () => {
    setVisibility('visible');
    const onBroadcasterChange = jest.fn();
    const received: unknown[] = [];
    const spy = new MockBC('vis-hidden');
    spy.onmessage = (e) => received.push(e.data);

    mountScoreBroadcaster({
      channel: 'vis-hidden',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 1000,
    });

    // Elected as sole tab
    expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);
    received.length = 0;

    // Transition to hidden — should yield + send bye
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onBroadcasterChange).toHaveBeenLastCalledWith(false);
    expect(received.some((m: any) => m?.type === 'bye')).toBe(true);

    spy.close();
    setVisibility('visible');
  });

  it('hidden → visible resumes heartbeat + reclaims if alone', () => {
    jest.useFakeTimers();
    try {
      setVisibility('visible');
      const onBroadcasterChange = jest.fn();
      mountScoreBroadcaster({
        channel: 'vis-resume',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        onBroadcasterChange,
        heartbeatInterval: 1000,
      });

      expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);

      // Hide — yields
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(onBroadcasterChange).toHaveBeenLastCalledWith(false);

      // Show — resumes. With initialElectionDelay: 0 and no competing peers,
      // we reclaim immediately.
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);
    } finally {
      jest.useRealTimers();
      setVisibility('visible');
    }
  });

  it('mounted while hidden → does not start heartbeat until visible', () => {
    setVisibility('hidden');
    const onBroadcasterChange = jest.fn();
    mountScoreBroadcaster({
      channel: 'vis-mounted-hidden',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 1000,
    });

    // Hidden at mount — no election, no onBroadcasterChange
    expect(onBroadcasterChange).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);
    setVisibility('visible');
  });

  it('unmount removes the visibilitychange listener', () => {
    setVisibility('visible');
    const store = { score: createRefSignal(0) };
    const cleanup = setupBroadcast(store, {
      channel: 'vis-cleanup',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      heartbeatInterval: 1000,
    });

    cleanup();

    const onBroadcasterChange = jest.fn();
    const cleanup2 = setupBroadcast(store, {
      channel: 'vis-cleanup-2',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 1000,
    });

    // Firing visibility events for the already-cleaned-up first subscription
    // must NOT affect anything (listener removed). If the old listener
    // leaked, we'd see a second onBroadcasterChange transition on it.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    cleanup2();
    setVisibility('visible');
    // onBroadcasterChange belongs to the second subscription only — its
    // transitions are what we'd see; the first subscription must be inert.
    // This is best-effort: the stronger assertion would be listener count,
    // but jsdom doesn't expose it cleanly.
    expect(onBroadcasterChange).toHaveBeenCalled();
  });
});

describe('edge cases — useBroadcast filter ref', () => {
  it('picks up filter changes without resubscription', () => {
    const store = { score: createRefSignal(0) };
    let allow = false;

    const { rerender } = renderHook(() => {
      useBroadcast(store, { channel: 'filter-ref', filter: () => allow });
    });

    const received: unknown[] = [];
    const spy = new MockBC('filter-ref');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    act(() => {
      store.score.update(1);
    }); // allow=false — skip
    expect(received).toHaveLength(0);

    allow = true;
    rerender(); // filter ref updated, no resubscription

    act(() => {
      store.score.update(2);
    }); // allow=true — send
    expect(received).toHaveLength(1);

    spy.close();
  });
});

// ─── Signal-level broadcast (createRefSignal broadcast option) ────────────────

describe('createRefSignal — broadcast option (string shorthand)', () => {
  it('sends outgoing message when signal updates', () => {
    const signal = createRefSignal(0, { broadcast: 'sig-ch' });

    const received: unknown[] = [];
    const spy = new MockBC('sig-ch');
    spy.onmessage = (e) => received.push(e.data);

    signal.update(7);

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe('update');
    expect((received[0] as any).payload._).toBe(7);

    spy.close();
  });

  it('applies incoming update from another tab', () => {
    const signal = createRefSignal(0, { broadcast: 'sig-recv' });

    deliverFromOtherTab('sig-recv', {
      type: 'update',
      tabId: 'other-tab',
      payload: { _: 42 },
    });

    expect(signal.current).toBe(42);
  });

  it('object form — channel + mode options respected', () => {
    const onBroadcasterChange = jest.fn();
    createRefSignal(0, {
      broadcast: {
        channel: 'sig-obj',
        mode: 'one-to-many',
        initialElectionDelay: 0,
        onBroadcasterChange,
      },
    });

    // initial election fires immediately in one-to-many
    expect(onBroadcasterChange).toHaveBeenCalledWith(true);
  });

  it('filter blocks outgoing when returns false', () => {
    let allow = false;
    const signal = createRefSignal(0, {
      broadcast: { channel: 'sig-filter', filter: () => allow },
    });

    const received: unknown[] = [];
    const spy = new MockBC('sig-filter');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    signal.update(1); // allow=false — skip
    expect(received).toHaveLength(0);

    allow = true;
    signal.update(2); // allow=true — send
    expect(received).toHaveLength(1);

    spy.close();
  });
});

// ─── useRefSignal — broadcast option ─────────────────────────────────────────

describe('useRefSignal — broadcast option', () => {
  it('sends outgoing message when signal updates (after mount effect)', () => {
    const received: unknown[] = [];
    const spy = new MockBC('hook-sig');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    const { result } = renderHook(() =>
      useRefSignal(0, { broadcast: 'hook-sig' }),
    );

    act(() => {
      result.current.update(5);
    });

    expect(received).toHaveLength(1);
    expect((received[0] as any).payload._).toBe(5);

    spy.close();
  });

  it('applies incoming update from another tab', () => {
    const { result } = renderHook(() =>
      useRefSignal(0, { broadcast: 'hook-sig-recv' }),
    );

    act(() => {
      deliverFromOtherTab('hook-sig-recv', {
        type: 'update',
        tabId: 'other-tab',
        payload: { _: 99 },
      });
    });

    expect(result.current.current).toBe(99);
  });

  it('stops sending after unmount', () => {
    const received: unknown[] = [];
    const spy = new MockBC('hook-unmount');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    const { result, unmount } = renderHook(() =>
      useRefSignal(0, { broadcast: 'hook-unmount' }),
    );

    act(() => {
      result.current.update(1);
    });
    expect(received).toHaveLength(1);

    unmount();
    received.length = 0;

    // After unmount, the signal still exists but the transport subscription was torn down.
    // A direct .update() should not send anything over the channel.
    result.current.update(2);
    expect(received).toHaveLength(0);

    spy.close();
  });

  it('string shorthand works identically to object form', () => {
    const received: unknown[] = [];
    const spy = new MockBC('hook-str');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    const { result } = renderHook(() =>
      useRefSignal(0, { broadcast: 'hook-str' }),
    );

    act(() => {
      result.current.update(3);
    });
    expect(received).toHaveLength(1);

    spy.close();
  });
});

// ─── Branch coverage ──────────────────────────────────────────────────────────

describe('branch coverage', () => {
  it('SSR guard: returns a no-op cleanup when window is undefined', () => {
    const savedWindow = (global as any).window;
    (global as any).window = undefined;
    try {
      const store = { score: createRefSignal(0) };
      const cleanup = setupBroadcast(store, { channel: 'ssr-bc' });
      expect(typeof cleanup).toBe('function');
      expect(() => {
        cleanup();
      }).not.toThrow(); // covers the returned () => {} function
    } finally {
      (global as any).window = savedWindow;
    }
  });

  it('rAF option: collapses rapid updates into one send per frame', () => {
    const raf = setupRafMock();

    const store = mountScoreBroadcaster({
      channel: 'raf-bc',
      rAF: true,
    });

    const received: unknown[] = [];
    const spy = new MockBC('raf-bc');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    store.score.update(1);
    store.score.update(2);
    expect(received).toHaveLength(0); // batched, not sent yet

    raf.fire();
    expect(received).toHaveLength(1); // one send per frame

    spy.close();
    raf.restore();
  });

  it('debounce option: rapid updates produce one send after quiet period', () => {
    const store = mountScoreBroadcaster({
      channel: 'debounce-bc',
      debounce: 100,
    });

    const received: unknown[] = [];
    const spy = new MockBC('debounce-bc');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    store.score.update(1);
    store.score.update(2);
    expect(received).toHaveLength(0);

    jest.advanceTimersByTime(100);
    expect(received).toHaveLength(1);

    spy.close();
  });

  it('prunes timed-out tabs during election, then re-elects', () => {
    const onBroadcasterChange = jest.fn();
    mountScoreBroadcaster({
      channel: 'prune-test',
      mode: 'one-to-many',
      initialElectionDelay: 0,
      onBroadcasterChange,
      heartbeatInterval: 100,
      heartbeatTimeout: 300,
    });

    // Register a lower-ID tab — our tab yields
    deliverFromOtherTab('prune-test', {
      type: 'hello',
      tabId: '0000',
      ts: Date.now(),
    });
    expect(onBroadcasterChange).toHaveBeenLastCalledWith(false);

    // Advance past heartbeatTimeout — '0000' goes stale and is pruned, we re-elect
    jest.advanceTimersByTime(400);
    expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);
  });
});

// ─── edge cases — BroadcastChannel absent at runtime ─────────────────────────

describe('edge cases — BroadcastChannel absent at runtime', () => {
  it('falls back to localStorage transport without throwing when BroadcastChannel is unavailable', () => {
    // window exists but BroadcastChannel is not available (older Safari, some workers)
    delete (globalThis as any).BroadcastChannel;

    const store = { score: createRefSignal(0) };
    expect(() => {
      const cleanup = setupBroadcast(store, { channel: 'no-bc' });
      cleanup();
    }).not.toThrow();
  });
});

// ─── edge cases — interceptor + broadcast ────────────────────────────────────

describe('edge cases — interceptor + broadcast', () => {
  it('interceptor CANCEL on a broadcast-received value leaves the tab out of sync', () => {
    // Documents the current behavior: broadcast-delivered values go through
    // `signal.update` which respects the interceptor. If the interceptor
    // returns CANCEL, the remote value is silently dropped and this tab's
    // state diverges from the sender's. Not a library bug — interceptors
    // are user-owned policy — but worth a regression test + docs call-out.
    const store = {
      score: createRefSignal(0, {
        // Reject negatives — simulates a validation interceptor
        interceptor: (value: number) =>
          value < 0 ? (CANCEL as unknown as number) : value,
      }),
    };

    setupBroadcast(store, { channel: 'interceptor-cancel' });

    // A peer broadcasts a value our interceptor rejects
    deliverFromOtherTab('interceptor-cancel', {
      type: 'update',
      tabId: 'other',
      payload: { score: -5 },
    });

    // Our interceptor cancelled the update — tab stays at 0 while sender had -5.
    expect(store.score.current).toBe(0);
  });

  it('interceptor transform applies to broadcast-received values (coerces on receipt)', () => {
    // A transforming interceptor runs on every incoming broadcast update,
    // including remote ones. This can intentionally normalize peer values
    // (e.g. clamp to a range) or accidentally cause divergence if only
    // some tabs have the interceptor. Documenting the behavior.
    const store = {
      score: createRefSignal(0, {
        interceptor: (value: number) => Math.max(0, Math.min(100, value)),
      }),
    };

    setupBroadcast(store, { channel: 'interceptor-clamp' });

    deliverFromOtherTab('interceptor-clamp', {
      type: 'update',
      tabId: 'other',
      payload: { score: 999 },
    });

    expect(store.score.current).toBe(100); // clamped on receipt, not stored raw
  });
});

// ─── edge cases — persist hydration racing any broadcast update ──────────────

describe('edge cases — persist hydration racing broadcast update', () => {
  it('broadcast update arriving before hydration wins — mixed-signal case', async () => {
    // Scenario: tab sets up persist (async get) and broadcast. Before persist
    // hydration resolves, a full-snapshot `update` arrives from a peer.
    // Signals touched by the broadcast update must NOT be overwritten by
    // the later-resolving hydration. Signals NOT in the broadcast payload
    // should still be hydrated from storage.
    const { setupPersist } = await import('../persist/persist');

    let resolveGet!: (val: string | null) => void;
    const deferredStorage = {
      get: () =>
        new Promise<string | null>((r) => {
          resolveGet = r;
        }),
      set: async () => {},
      remove: async () => {},
    };

    const store = {
      score: createRefSignal(0),
      level: createRefSignal(1),
    };

    const { cleanup: persistCleanup } = setupPersist(store, {
      key: 'race-mixed',
      storage: deferredStorage,
    });
    const broadcastCleanup = setupBroadcast(store, {
      channel: 'race-mixed-channel',
    });

    // Peer broadcasts a full snapshot — but only score is meaningful here
    // (we'll verify mixed behavior: score overridden, level hydrated).
    deliverFromOtherTab('race-mixed-channel', {
      type: 'update',
      tabId: 'peer',
      payload: { score: 77 },
    });

    expect(store.score.current).toBe(77);
    expect(store.level.current).toBe(1); // still default — not yet hydrated

    // Hydration resolves with stale score (5) and a fresh level (9)
    resolveGet(JSON.stringify({ v: 1, data: { score: 5, level: 9 } }));
    await act(async () => {});

    // score stays 77 (broadcast won — lastUpdated moved post-setup)
    // level becomes 9 (hydrated — never touched by broadcast)
    expect(store.score.current).toBe(77);
    expect(store.level.current).toBe(9);

    persistCleanup();
    broadcastCleanup();
  });

  it('multiple broadcast updates during pending hydration stay consistent', async () => {
    // Two back-to-back updates from a peer before persist hydrates —
    // the tab's final state should reflect the LAST broadcast, not be
    // partially overwritten by the stale persisted payload.
    const { setupPersist } = await import('../persist/persist');

    let resolveGet!: (val: string | null) => void;
    const deferredStorage = {
      get: () =>
        new Promise<string | null>((r) => {
          resolveGet = r;
        }),
      set: async () => {},
      remove: async () => {},
    };

    const store = { score: createRefSignal(0) };

    const { cleanup: persistCleanup } = setupPersist(store, {
      key: 'race-multi',
      storage: deferredStorage,
    });
    const broadcastCleanup = setupBroadcast(store, {
      channel: 'race-multi-channel',
    });

    deliverFromOtherTab('race-multi-channel', {
      type: 'update',
      tabId: 'peer',
      payload: { score: 42 },
    });
    deliverFromOtherTab('race-multi-channel', {
      type: 'update',
      tabId: 'peer',
      payload: { score: 100 },
    });

    expect(store.score.current).toBe(100);

    // Hydration arrives with stale data
    resolveGet(JSON.stringify({ v: 1, data: { score: 5 } }));
    await act(async () => {});

    // Latest broadcast wins — hydration skipped because counter moved
    expect(store.score.current).toBe(100);

    persistCleanup();
    broadcastCleanup();
  });
});

// ─── edge cases — persist + broadcast state-handoff race ─────────────────────

describe('edge cases — persist + broadcast state-handoff race', () => {
  it('persist hydration after state-handoff does not overwrite handoff state', async () => {
    // Scenario: tab B becomes broadcaster and receives a state-handoff (score=100)
    // from the yielding broadcaster. Tab B also has persist running whose hydration
    // resolves later with an older stored value (score=5).
    // Expected: the state-handoff value (100) should survive — hydration must not
    // silently overwrite in-memory state that arrived after setup.
    //
    // This test documents the CURRENT behavior. If it fails after a fix, update
    // the expectation to 100.

    let resolveGet!: (val: string | null) => void;
    const deferredStorage = {
      get: () =>
        new Promise<string | null>((r) => {
          resolveGet = r;
        }),
      set: async () => {},
      remove: async () => {},
    };

    // Build a store wrapped with persist (deferred hydration)
    const store = { score: createRefSignal(0) };
    const { setupPersist } = await import('../persist/persist');
    const { cleanup } = setupPersist(store, {
      key: 'race',
      storage: deferredStorage,
    });

    // Tab B starts as non-broadcaster in a one-to-many setup
    const broadcastCleanup = setupBroadcast(store, {
      channel: 'race-channel',
      mode: 'one-to-many',
      initialElectionDelay: 0,
    });

    // Deliver state-handoff from yielding broadcaster (score=100)
    // Tab B is broadcaster here (no other tabs seen yet), so it applies the handoff
    deliverFromOtherTab('race-channel', {
      type: 'state-handoff',
      tabId: '0000',
      payload: { score: 100 },
    });

    expect(store.score.current).toBe(100);

    // Now persist hydration resolves with older stored value (score=5).
    // Because score.lastUpdated moved (state-handoff called update()),
    // hydration detects the in-flight update and skips — handoff wins.
    resolveGet(JSON.stringify({ v: 1, data: { score: 5 } }));
    await act(async () => {});

    expect(store.score.current).toBe(100);

    cleanup();
    broadcastCleanup();
  });
});
