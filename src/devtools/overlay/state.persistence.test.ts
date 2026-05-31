/**
 * @jest-environment jsdom
 */

// The read helpers in state.ts run once at module load, so each case
// re-imports the module with localStorage pre-seeded to exercise a branch.
const KEYS = {
  height: '__refsignal_devtools_height',
  collapsed: '__refsignal_devtools_collapsed',
  tab: '__refsignal_devtools_tab',
  rate: '__refsignal_devtools_rate',
};

const loadState = (): Promise<typeof import('./state')> => import('./state');

describe('overlay state — localStorage persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
  });

  it('hydrates valid persisted values on first read', async () => {
    localStorage.setItem(KEYS.height, '500');
    localStorage.setItem(KEYS.collapsed, '1');
    localStorage.setItem(KEYS.tab, 'cascade');
    localStorage.setItem(KEYS.rate, '2hz');
    const { dockHeight, collapsed, activeTab, renderRate } = await loadState();
    expect(dockHeight.current).toBe(500);
    expect(collapsed.current).toBe(true);
    expect(activeTab.current).toBe('cascade');
    expect(renderRate.current).toBe('2hz');
  });

  it('falls back to defaults when stored values are invalid', async () => {
    localStorage.setItem(KEYS.height, 'NaNny'); // parseInt → NaN
    localStorage.setItem(KEYS.collapsed, '0'); // anything but '1' → false
    localStorage.setItem(KEYS.tab, 'not-a-tab'); // not in allow-list
    localStorage.setItem(KEYS.rate, 'not-a-rate'); // not a preset id
    const { dockHeight, collapsed, activeTab, renderRate } = await loadState();
    expect(dockHeight.current).toBe(320);
    expect(collapsed.current).toBe(false);
    expect(activeTab.current).toBe('signals');
    expect(renderRate.current).toBe('10hz');
  });

  it('treats a height at or below the floor as the default', async () => {
    localStorage.setItem(KEYS.height, '50'); // finite but <= 80
    const { dockHeight } = await loadState();
    expect(dockHeight.current).toBe(320);
  });

  it('uses defaults when nothing is stored', async () => {
    const { dockHeight, collapsed, activeTab, renderRate } = await loadState();
    expect(dockHeight.current).toBe(320);
    expect(collapsed.current).toBe(false);
    expect(activeTab.current).toBe('signals');
    expect(renderRate.current).toBe('10hz');
  });

  it('writes changes back to localStorage', async () => {
    const { dockHeight, collapsed, activeTab, renderRate } = await loadState();
    dockHeight.update(640);
    collapsed.update(true);
    activeTab.update('pulse');
    renderRate.update('1hz');
    expect(localStorage.getItem(KEYS.height)).toBe('640');
    expect(localStorage.getItem(KEYS.collapsed)).toBe('1');
    expect(localStorage.getItem(KEYS.tab)).toBe('pulse');
    expect(localStorage.getItem(KEYS.rate)).toBe('1hz');
    collapsed.update(false);
    expect(localStorage.getItem(KEYS.collapsed)).toBe('0');
  });
});
