/**
 * @jest-environment node
 *
 * Runs in a pure Node.js environment where `typeof window === 'undefined'`,
 * exercising the SSR guard in setupBroadcast.
 */

import { createRefSignal } from '../refsignal';
import { setupBroadcast } from './broadcast';

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
