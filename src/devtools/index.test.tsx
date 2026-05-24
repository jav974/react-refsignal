/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { devtools, mountDevTools, type DevToolsAdapter } from './index';

describe('mountDevTools', () => {
  afterEach(() => {
    // Drain any host containers between tests.
    document
      .querySelectorAll('[data-refsignal-devtools-host]')
      .forEach((el) => {
        el.parentNode?.removeChild(el);
      });
  });

  it('mounts a fresh host element to <body> by default, returns a cleanup', () => {
    const before = document.querySelectorAll(
      '[data-refsignal-devtools-host]',
    ).length;
    let dispose!: () => void;
    act(() => {
      dispose = mountDevTools();
    });
    expect(
      document.querySelectorAll('[data-refsignal-devtools-host]').length,
    ).toBe(before + 1);
    act(() => {
      dispose();
    });
    expect(
      document.querySelectorAll('[data-refsignal-devtools-host]').length,
    ).toBe(before);
  });

  it('mounts into a user-provided container without creating one', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const before = document.querySelectorAll(
      '[data-refsignal-devtools-host]',
    ).length;
    let dispose!: () => void;
    act(() => {
      dispose = mountDevTools({ container });
    });
    // No auto-host because we provided our own
    expect(
      document.querySelectorAll('[data-refsignal-devtools-host]').length,
    ).toBe(before);
    // But the overlay element should be inside our container
    expect(
      container.querySelector('[data-testid="refsignal-devtools"]'),
    ).toBeTruthy();
    act(() => {
      dispose();
    });
    container.remove();
  });

  it('subsequent mountDevTools calls while already mounted return a no-op', () => {
    let dispose1!: () => void;
    let dispose2!: () => void;
    act(() => {
      dispose1 = mountDevTools();
    });
    act(() => {
      dispose2 = mountDevTools();
    });
    // Both cleanup functions can be called safely
    act(() => {
      dispose2();
    });
    act(() => {
      dispose1();
    });
  });

  it('returns a no-op dispose in production builds', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const dispose = mountDevTools();
      // No host created
      expect(
        document.querySelectorAll('[data-refsignal-devtools-host]').length,
      ).toBe(0);
      // Cleanup is callable
      dispose();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('dispose is idempotent (double-call is a safe no-op)', () => {
    let dispose!: () => void;
    act(() => {
      dispose = mountDevTools();
    });
    act(() => {
      dispose();
    });
    // Second call hits the early-return inside the cleanup closure.
    expect(() => {
      dispose();
    }).not.toThrow();
  });

  it('exports the singleton devtools adapter with a DevToolsAdapter shape', () => {
    const adapter: DevToolsAdapter = devtools;
    // satisfies all six required methods
    expect(typeof adapter.trackUpdate).toBe('function');
    expect(typeof adapter.registerSignal).toBe('function');
    expect(typeof adapter.getSignalName).toBe('function');
    expect(typeof adapter.trackEffectStart).toBe('function');
    expect(typeof adapter.trackEffectEnd).toBe('function');
    expect(typeof adapter.emit).toBe('function');
    expect(typeof adapter.trackNotify).toBe('function');
  });
});
