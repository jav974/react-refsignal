/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { createRefSignal } from '../refsignal';
import { broadcast, useBroadcast } from './index';
import { setupBroadcast } from './broadcast';
import { useRefSignal } from '../hooks/useRefSignal';

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

// Helper: simulate a message arriving from another tab on a channel
function deliverFromOtherTab(channel: string, msg: unknown) {
  for (const entry of buses.get(channel) ?? []) {
    entry.instance.onmessage?.({ data: msg });
  }
}

// ─── broadcast() — factory wrapper ───────────────────────────────────────────

describe('broadcast() — many-to-many', () => {
  it('sends snapshot to other tabs when a signal updates', () => {
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
    });
    const store = factory();

    deliverFromOtherTab('test', {
      type: 'update',
      tabId: 'other-tab',
      payload: { score: 99 },
    });

    expect(store.score.current).toBe(99);
  });

  it('ignores own messages (tabId check)', () => {
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
      filter: (s) => s.score > 10,
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
      throttle: 100,
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'test',
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'elect',
      mode: 'one-to-many',
      onBroadcasterChange,
      heartbeatInterval: 100,
    });
    factory();

    // Immediate election with no competition — should win
    expect(onBroadcasterChange).toHaveBeenCalledWith(true);
  });

  it('elected tab sends updates; non-elected tab does not', () => {
    const received: unknown[] = [];

    // Tab A — broadcaster
    const factoryA = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'elect',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });
    const storeA = factoryA();

    const bc = new MockBC('elect');
    bc.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    storeA.score.update(10);
    expect(received).toHaveLength(1);
    bc.close();
  });

  it('non-broadcaster receives incoming updates', () => {
    broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'recv',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });

    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'recv',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });
    const store = factory();

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
    const factory1 = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'bye-test',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });
    factory1();

    // Second tab — observes
    const factory2 = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'bye-test',
      mode: 'one-to-many',
      heartbeatInterval: 100,
      onBroadcasterChange,
    });
    factory2();

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
        heartbeatInterval: 1000,
      });
    });

    unmount();

    const byeMsgs = received.filter((m: any) => m?.type === 'bye');
    expect(byeMsgs).toHaveLength(1);

    bc.close();
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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'yield',
      mode: 'one-to-many',
      onBroadcasterChange,
      heartbeatInterval: 100,
    });
    factory();

    // Our tab won election immediately — should be broadcaster
    expect(onBroadcasterChange).toHaveBeenLastCalledWith(true);

    // A tab with a lexicographically smaller ID claims broadcaster
    deliverFromOtherTab('yield', { type: 'broadcaster-claim', tabId: '0000' });

    expect(onBroadcasterChange).toHaveBeenLastCalledWith(false);
  });

  it('yields to a lower-ID tab announced via hello, sends state-handoff', () => {
    const onBroadcasterChange = jest.fn();
    const factory = broadcast(() => ({ score: createRefSignal(42) }), {
      channel: 'hello-yield',
      mode: 'one-to-many',
      onBroadcasterChange,
      heartbeatInterval: 1000,
    });
    factory();

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

    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'timeout-test',
      mode: 'one-to-many',
      onBroadcasterChange,
      heartbeatInterval: 100,
      heartbeatTimeout: 500,
    });
    factory();

    // The other tab (0000) should win election initially since it was seen
    // After heartbeatTimeout ms of silence, it gets pruned and we take over
    jest.advanceTimersByTime(600); // past heartbeatTimeout

    expect(onBroadcasterChange).toHaveBeenCalledWith(true);
  });

  it('sends state-handoff when yielding to a lower-ID broadcaster-claim', () => {
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'handoff-send',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'handoff-recv',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'handoff-ignore',
      mode: 'one-to-many',
      heartbeatInterval: 100,
    });
    const store = factory();

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
    let rafCb: FrameRequestCallback | null = null;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb = cb;
      return 1;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'raf-bc',
      rAF: true,
    });
    const store = factory();

    const received: unknown[] = [];
    const spy = new MockBC('raf-bc');
    spy.onmessage = (e) => {
      if ((e.data as any)?.type === 'update') received.push(e.data);
    };

    store.score.update(1);
    store.score.update(2);
    expect(received).toHaveLength(0); // batched, not sent yet

    rafCb?.(0);
    expect(received).toHaveLength(1); // one send per frame

    spy.close();
    jest.restoreAllMocks();
  });

  it('debounce option: rapid updates produce one send after quiet period', () => {
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'debounce-bc',
      debounce: 100,
    });
    const store = factory();

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
    const factory = broadcast(() => ({ score: createRefSignal(0) }), {
      channel: 'prune-test',
      mode: 'one-to-many',
      onBroadcasterChange,
      heartbeatInterval: 100,
      heartbeatTimeout: 300,
    });
    factory();

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
