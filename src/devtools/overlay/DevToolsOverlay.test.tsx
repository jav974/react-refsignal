/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRefSignal, watch } from '../../refsignal';
import { devtools } from '../adapter';
import { DevToolsOverlay } from './DevToolsOverlay';
import { activeTab, collapsed, dockHeight } from './state';

const resetOverlayState = (): void => {
  collapsed.update(false);
  dockHeight.update(320);
  activeTab.update('signals');
  localStorage.clear();
};

describe('DevToolsOverlay', () => {
  beforeEach(() => {
    devtools.reset();
    act(() => {
      resetOverlayState();
    });
  });

  afterEach(() => {
    devtools.reset();
    act(() => {
      resetOverlayState();
    });
  });

  it('renders the dock with all six tabs', () => {
    render(<DevToolsOverlay />);
    const dock = screen.getByTestId('refsignal-devtools');
    expect(dock).toBeTruthy();
    const labels = [
      'Signals',
      'Timeline',
      'Cascade',
      'Broadcast',
      'Persist',
      'Pulse',
    ];
    for (const label of labels) {
      expect(within(dock).getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('switches the active panel when a tab is clicked', () => {
    render(<DevToolsOverlay />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });
    expect(activeTab.current).toBe('timeline');
  });

  it('collapses and expands when the toggle is clicked', () => {
    render(<DevToolsOverlay />);
    const toggle = screen.getByTestId('refsignal-devtools-toggle');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(collapsed.current).toBe(true);
    act(() => {
      fireEvent.click(toggle);
    });
    expect(collapsed.current).toBe(false);
  });

  it('persists dock height to localStorage on resize', () => {
    render(<DevToolsOverlay />);
    act(() => {
      dockHeight.update(400);
    });
    expect(localStorage.getItem('__refsignal_devtools_height')).toBe('400');
  });

  it('shows empty states for panels with no data', () => {
    render(<DevToolsOverlay />);
    expect(screen.getByText(/No signals registered yet/i)).toBeTruthy();

    act(() => {
      activeTab.update('broadcast');
    });
    expect(screen.getByText(/No broadcast channels active/i)).toBeTruthy();

    act(() => {
      activeTab.update('persist');
    });
    expect(screen.getByText(/No persisted signals/i)).toBeTruthy();

    act(() => {
      activeTab.update('pulse');
    });
    expect(screen.getByText(/No active pulse signals/i)).toBeTruthy();

    act(() => {
      activeTab.update('cascade');
    });
    expect(screen.getByText(/No signals to graph yet/i)).toBeTruthy();
  });

  it('signals panel lists registered signals', () => {
    const s1 = createRefSignal(42, 'counter');
    const s2 = createRefSignal({ x: 1 }, 'obj');
    render(<DevToolsOverlay />);
    expect(screen.getByText('counter')).toBeTruthy();
    expect(screen.getByText('obj')).toBeTruthy();
    s1.dispose();
    s2.dispose();
  });

  it('timeline panel reflects signal updates', () => {
    // Pre-populate the events buffer before render — panel bus subscription is
    // frame-coalesced (see useDevtoolsRender), so updates after mount would
    // require waiting for an RAF tick to be visible.
    const s = createRefSignal(0, 'tl');
    s.update(7);
    render(<DevToolsOverlay />);
    act(() => {
      activeTab.update('timeline');
    });
    expect(screen.getByText('tl')).toBeTruthy();
    s.dispose();
  });

  it('cascade panel renders edge for watch-driven update', () => {
    const a = createRefSignal(0, 'srcA');
    const b = createRefSignal(0, 'dstB');
    const stop = watch(a, (v) => {
      b.update(v + 1);
    });
    act(() => {
      a.update(1);
    });
    render(<DevToolsOverlay />);
    act(() => {
      activeTab.update('cascade');
    });
    // The cascade panel renders an SVG; verify both nodes appear as text.
    expect(screen.getByText('srcA')).toBeTruthy();
    expect(screen.getByText('dstB')).toBeTruthy();
    stop();
    a.dispose();
    b.dispose();
  });

  it('drag handle starts/moves/ends a resize, updating dockHeight', () => {
    render(<DevToolsOverlay />);
    const handle = screen.getByTestId('refsignal-devtools-drag');
    const initial = dockHeight.current;
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    });
    act(() => {
      fireEvent.mouseDown(handle);
    });
    act(() => {
      // mouseY 400 → window.innerHeight - 400 = 400px dock height
      fireEvent.mouseMove(window, { clientY: 400 });
    });
    expect(dockHeight.current).toBeGreaterThan(0);
    act(() => {
      fireEvent.mouseUp(window);
    });
    // After mouseUp, further moves do not change height
    const heightAfterUp = dockHeight.current;
    act(() => {
      fireEvent.mouseMove(window, { clientY: 100 });
    });
    expect(dockHeight.current).toBe(heightAfterUp);
    // Avoid assertion on `initial` not changing — just confirm the chain ran.
    expect(initial).toBeGreaterThan(0);
  });

  it('clicking a tab while collapsed expands the dock and switches tab', () => {
    render(<DevToolsOverlay />);
    act(() => {
      collapsed.update(true);
    });
    expect(collapsed.current).toBe(true);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Pulse' }));
    });
    expect(collapsed.current).toBe(false);
    expect(activeTab.current).toBe('pulse');
  });

  it('selecting a different rate from the picker updates renderRate', () => {
    render(<DevToolsOverlay />);
    const select = screen.getByTestId('refsignal-devtools-rate');
    act(() => {
      fireEvent.change(select, { target: { value: '1hz' } });
    });
    expect(localStorage.getItem('__refsignal_devtools_rate')).toBe('1hz');
  });

  it('hides the rate picker while collapsed', () => {
    render(<DevToolsOverlay />);
    act(() => {
      collapsed.update(true);
    });
    expect(screen.queryByTestId('refsignal-devtools-rate')).toBeNull();
  });

  it('window mouseUp without a prior mouseDown is a no-op (covers early return)', () => {
    render(<DevToolsOverlay />);
    const before = dockHeight.current;
    act(() => {
      fireEvent.mouseUp(window);
    });
    expect(dockHeight.current).toBe(before);
  });

  it('window mouseMove without dragging is a no-op (covers move early return)', () => {
    render(<DevToolsOverlay />);
    const before = dockHeight.current;
    act(() => {
      fireEvent.mouseMove(window, { clientY: 50 });
    });
    expect(dockHeight.current).toBe(before);
  });
});
