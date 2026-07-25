/**
 * @jest-environment node
 *
 * Runs in a pure Node.js environment where `typeof window === 'undefined'`,
 * exercising the SSR guard in setupBroadcast.
 */

import { createRefSignal } from '../refsignal';
import { setupBroadcast } from './broadcast';
import type { Transport } from './transport';

describe('broadcast SSR guard', () => {
  it('returns a no-op cleanup and covers the () => {} function when window is undefined', () => {
    expect(typeof window).toBe('undefined'); // sanity check — we are in Node env

    const store = { score: createRefSignal(0) };
    const cleanup = setupBroadcast(store, { channel: 'ssr-node' });

    expect(typeof cleanup).toBe('function');
    expect(() => {
      cleanup();
    }).not.toThrow(); // invokes the returned () => {} to cover func
  });
});

// A custom transport bypasses the environment guard — this Node environment
// (no window, no document, no BroadcastChannel) is exactly a Web Worker's.
// One live instance per test: two instances in one process would share the
// module-scope TAB_ID and ignore each other as self-echoes.
describe('broadcast with custom transport in a worker-like environment', () => {
  function recordingTransport() {
    const posted: unknown[] = [];
    let deliver: ((msg: unknown) => void) | null = null;
    const transport: Transport = {
      post: (msg) => {
        posted.push(msg);
      },
      listen: (cb) => {
        deliver = cb;
        return () => {
          deliver = null;
        };
      },
    };
    return { transport, posted, receive: (msg: unknown) => deliver?.(msg) };
  }

  it('sends and applies updates over a custom transport with no window/document', () => {
    const { transport, posted, receive } = recordingTransport();
    const store = { score: createRefSignal(0) };
    const cleanup = setupBroadcast(store, { channel: 'w', transport });

    store.score.update(5);
    expect(posted).toContainEqual(
      expect.objectContaining({ type: 'update', payload: { score: 5 } }),
    );

    receive({ type: 'update', tabId: 'other', payload: { score: 9 } });
    expect(store.score.current).toBe(9);

    cleanup();
  });

  it('one-to-many elects without document (heartbeat runs unconditionally)', () => {
    jest.useFakeTimers();
    try {
      const { transport } = recordingTransport();
      const store = { score: createRefSignal(0) };
      const onChange = jest.fn();

      const cleanup = setupBroadcast(store, {
        channel: 'w2',
        mode: 'one-to-many',
        transport,
        onBroadcasterChange: onChange,
      });

      // Past initialElectionDelay (default heartbeatInterval + 100 = 400ms):
      // alone on the channel, this instance claims broadcaster.
      jest.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledWith(true);

      cleanup();
    } finally {
      jest.useRealTimers();
    }
  });
});
