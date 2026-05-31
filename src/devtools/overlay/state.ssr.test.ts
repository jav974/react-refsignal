/**
 * @jest-environment node
 *
 * Runs in pure Node where `localStorage` is undefined, exercising the SSR
 * fallbacks in the overlay state read helpers — they must return defaults
 * rather than throwing, so the dock can hydrate cleanly on the client.
 */

describe('overlay state — SSR (no localStorage)', () => {
  it('localStorage and window are undefined in this environment (sanity)', () => {
    expect(typeof localStorage).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('reads fall back to defaults when localStorage is unavailable', async () => {
    const { dockHeight, collapsed, activeTab, renderRate } = await import(
      './state'
    );
    expect(dockHeight.current).toBe(320);
    expect(collapsed.current).toBe(false);
    expect(activeTab.current).toBe('signals');
    expect(renderRate.current).toBe('10hz');
  });
});
