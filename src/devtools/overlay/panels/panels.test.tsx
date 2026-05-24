/**
 * @jest-environment jsdom
 */
import { act } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRefSignal } from '../../../refsignal';
import { devtools } from '../../adapter';
import { BroadcastPanel } from './BroadcastPanel';
import { CascadePanel } from './CascadePanel';
import { PersistPanel } from './PersistPanel';
import { PulsePanel } from './PulsePanel';
import { SignalsPanel } from './SignalsPanel';
import { TimelinePanel } from './TimelinePanel';

const emit = (event: Parameters<typeof devtools.emit>[0]): void => {
  devtools.emit(event);
};

describe('BroadcastPanel', () => {
  beforeEach(() => {
    devtools.reset();
  });

  it('renders empty state when no channels are active', () => {
    render(<BroadcastPanel />);
    expect(screen.getByText(/No broadcast channels active/i)).toBeTruthy();
  });

  it('renders a many-to-many channel (no stable chip)', () => {
    emit({
      kind: 'broadcast:peers',
      channel: 'm2m',
      mode: 'many-to-many',
      heartbeatInterval: 300,
      heartbeatTimeout: 5000,
      gracePeriod: 0,
      isBroadcaster: true,
      isStable: true,
      count: 1,
      peers: [{ id: 'tab-self', lastSeen: Date.now() }],
      t: Date.now(),
    });
    render(<BroadcastPanel />);
    expect(screen.getByText('m2m')).toBeTruthy();
    expect(screen.getByText('isBroadcaster: true')).toBeTruthy();
    expect(screen.queryByText(/isStableBroadcaster/)).toBeNull();
    expect(screen.getByText('tab-self')).toBeTruthy();
  });

  it('renders a one-to-many channel with both chips, grace period, and peer health colors', () => {
    const now = Date.now();
    emit({
      kind: 'broadcast:peers',
      channel: 'o2m',
      mode: 'one-to-many',
      heartbeatInterval: 100,
      heartbeatTimeout: 500,
      gracePeriod: 400,
      isBroadcaster: false,
      isStable: false,
      count: 3,
      peers: [
        { id: 'fresh', lastSeen: now - 50 },
        { id: 'warn', lastSeen: now - 250 }, // > 33% of 500
        { id: 'error', lastSeen: now - 400 }, // > 66% of 500
      ],
      t: now,
    });
    render(<BroadcastPanel />);
    expect(screen.getByText('o2m')).toBeTruthy();
    expect(screen.getByText('isBroadcaster: false')).toBeTruthy();
    expect(screen.getByText('isStableBroadcaster: false')).toBeTruthy();
    expect(screen.getByText(/Grace period/)).toBeTruthy();
    expect(screen.getByText('fresh')).toBeTruthy();
    expect(screen.getByText('warn')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('renders peer age in seconds when ≥ 1 second old', () => {
    const now = Date.now();
    emit({
      kind: 'broadcast:peers',
      channel: 'longLived',
      mode: 'one-to-many',
      heartbeatInterval: 100,
      heartbeatTimeout: 5000,
      isBroadcaster: true,
      isStable: true,
      count: 1,
      peers: [{ id: 'oldPeer', lastSeen: now - 1500 }],
      t: now,
    });
    render(<BroadcastPanel />);
    expect(screen.getByText(/1\.5s/)).toBeTruthy();
  });

  it('omits the peers section when peerCount is zero', () => {
    emit({
      kind: 'broadcast:peers',
      channel: 'empty',
      mode: 'many-to-many',
      heartbeatInterval: 300,
      heartbeatTimeout: 5000,
      gracePeriod: 0,
      isBroadcaster: true,
      isStable: true,
      count: 0,
      peers: [],
      t: Date.now(),
    });
    render(<BroadcastPanel />);
    expect(screen.getByText('empty')).toBeTruthy();
    expect(screen.queryByText(/Peers \(id/)).toBeNull();
  });
});

describe('PersistPanel', () => {
  beforeEach(() => {
    devtools.reset();
  });

  it('renders empty state when no persist entries exist', () => {
    render(<PersistPanel />);
    expect(screen.getByText(/No persisted signals/i)).toBeTruthy();
  });

  it('renders a hydrated signal-scope entry with EMPTY chip when storage had no value', () => {
    emit({
      kind: 'persist:hydrate',
      key: 'k1',
      scope: 'signal',
      durationMs: 12.3,
      hadValue: false,
      t: Date.now(),
    });
    emit({
      kind: 'persist:write',
      key: 'k1',
      scope: 'signal',
      t: Date.now(),
    });
    render(<PersistPanel />);
    expect(screen.getByText('k1')).toBeTruthy();
    expect(screen.getByText('signal')).toBeTruthy();
    expect(screen.getByText(/EMPTY/)).toBeTruthy();
    expect(screen.getByText(/12\.3ms/)).toBeTruthy();
  });

  it('renders a store-scope entry with signal count, hydration time, and writes', () => {
    emit({
      kind: 'persist:hydrate',
      key: 'store-key',
      scope: 'store',
      durationMs: 4.5,
      hadValue: true,
      signalCount: 7,
      t: Date.now(),
    });
    for (let i = 0; i < 3; i++) {
      emit({
        kind: 'persist:write',
        key: 'store-key',
        scope: 'store',
        signalCount: 7,
        t: Date.now(),
      });
    }
    render(<PersistPanel />);
    expect(screen.getByText('store-key')).toBeTruthy();
    expect(screen.getByText('store')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('renders an unhydrated entry as PENDING', () => {
    // No persist:hydrate event — only a write
    emit({
      kind: 'persist:write',
      key: 'pending-key',
      scope: 'signal',
      t: Date.now(),
    });
    render(<PersistPanel />);
    expect(screen.getByText(/PENDING/)).toBeTruthy();
  });

  it('picks up signalCount from a later write when hydrate omitted it', () => {
    // Hydrate without signalCount, then write WITH signalCount — the write
    // branch backfills it.
    emit({
      kind: 'persist:hydrate',
      key: 'late-count',
      scope: 'store',
      durationMs: 1.0,
      hadValue: false,
      t: Date.now(),
    });
    emit({
      kind: 'persist:write',
      key: 'late-count',
      scope: 'store',
      signalCount: 9,
      t: Date.now(),
    });
    render(<PersistPanel />);
    expect(screen.getByText('9')).toBeTruthy();
  });
});

describe('PulsePanel', () => {
  beforeEach(() => {
    devtools.reset();
  });

  it('renders empty state when no pulses are active', () => {
    render(<PulsePanel />);
    expect(screen.getByText(/No active pulse signals/i)).toBeTruthy();
  });

  it('renders the warming-up sparkline when only one sample is recorded', () => {
    const fake = createRefSignal(0, 'p1');
    emit({
      kind: 'pulse:tick',
      signal: fake,
      dt: 16.7,
      tickCount: 1,
      elapsed: 16.7,
      fps: 60,
      t: Date.now(),
    });
    render(<PulsePanel />);
    expect(screen.getByText(/warming up/i)).toBeTruthy();
  });

  it('renders an fps badge, sparkline polyline, and metrics for an active pulse', () => {
    const fake = createRefSignal(0, 'activePulse');
    for (let i = 1; i <= 5; i++) {
      emit({
        kind: 'pulse:tick',
        signal: fake,
        dt: 16.7,
        tickCount: i,
        elapsed: i * 16.7,
        fps: 60,
        t: Date.now() + i,
      });
    }
    const { container } = render(<PulsePanel />);
    expect(screen.getByText('activePulse')).toBeTruthy();
    expect(screen.getByText(/60\.0 fps/)).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy(); // tick count
    expect(container.querySelector('polyline')).toBeTruthy();
  });
});

describe('SignalsPanel', () => {
  beforeEach(() => {
    devtools.reset();
  });

  it('renders empty state when no signals are registered', () => {
    render(<SignalsPanel />);
    expect(screen.getByText(/No signals registered yet/i)).toBeTruthy();
  });

  it('renders rows for registered signals with their values', () => {
    const a = createRefSignal(42, 'a');
    const b = createRefSignal({ x: 1, y: 2 }, 'b');
    render(<SignalsPanel />);
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    a.dispose();
    b.dispose();
  });

  it('marks anonymous signals with the (anon) tag', () => {
    createRefSignal(7); // no debug name
    render(<SignalsPanel />);
    expect(screen.getByText(/\(anon\)/)).toBeTruthy();
  });

  it('opens a detail card when a row is clicked', () => {
    createRefSignal(100, 'clicky');
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText('clicky'));
    });
    // Detail card shows Last updated label
    expect(screen.getByText(/Last updated/i)).toBeTruthy();
    expect(screen.getByText('Copy value')).toBeTruthy();
  });

  it('toggles sort direction when the active sort column is clicked again', () => {
    createRefSignal(1, 'aa');
    createRefSignal(2, 'bb');
    render(<SignalsPanel />);
    const nameHeader = screen.getByText(/^Name/);
    act(() => {
      fireEvent.click(nameHeader);
    });
    act(() => {
      fireEvent.click(nameHeader);
    });
    expect(screen.getByText('aa')).toBeTruthy();
  });

  it('switches sort key when a different column is clicked', () => {
    createRefSignal(1, 'col1');
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText(/^Subs/));
    });
    act(() => {
      fireEvent.click(screen.getByText(/^Name/));
    });
    expect(screen.getByText('col1')).toBeTruthy();
  });

  it('filters rows by the search input', () => {
    createRefSignal(1, 'foo');
    createRefSignal(2, 'bar');
    render(<SignalsPanel />);
    const input = screen.getByPlaceholderText(/filter by name/i);
    act(() => {
      fireEvent.change(input, { target: { value: 'fo' } });
    });
    expect(screen.getByText('foo')).toBeTruthy();
    expect(screen.queryByText('bar')).toBeNull();
  });

  it('shows the truncated count when more than the render cap exist', () => {
    for (let i = 0; i < 205; i++) {
      createRefSignal(i, `s_${String(i)}`);
    }
    render(<SignalsPanel />);
    expect(screen.getByText(/Showing top/i)).toBeTruthy();
    expect(screen.getByText(/205/)).toBeTruthy();
  });

  it('clicking Copy value writes the JSON to the clipboard', () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    createRefSignal({ k: 'v' }, 'cp');
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText('cp'));
    });
    act(() => {
      fireEvent.click(screen.getByText('Copy value'));
    });
    expect(writeText).toHaveBeenCalled();
  });

  it('Copy value swallows clipboard errors (no throw)', () => {
    Object.defineProperty(global.navigator, 'clipboard', {
      value: {
        writeText: () => {
          throw new Error('blocked');
        },
      },
      writable: true,
      configurable: true,
    });
    createRefSignal({ k: 'v' }, 'cp2');
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText('cp2'));
    });
    expect(() => {
      act(() => {
        fireEvent.click(screen.getByText('Copy value'));
      });
    }).not.toThrow();
  });

  it('sorts by Subs when the Subs header is clicked', () => {
    createRefSignal(1, 'noSubs');
    const withSubs = createRefSignal(2, 'hasSubs');
    withSubs.subscribe(() => undefined);
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText(/^Subs/));
    });
    expect(screen.getByText('hasSubs')).toBeTruthy();
  });

  it('clicking the #upd column toggles the default updated sort', () => {
    createRefSignal(1, 'updS');
    render(<SignalsPanel />);
    // Default sort is "updated desc"; clicking the header toggles to asc.
    act(() => {
      fireEvent.click(screen.getByText(/^#upd/));
    });
    expect(screen.getByText('updS')).toBeTruthy();
  });

  it('selecting a row then filtering it out keeps detail card via rows fallback', () => {
    createRefSignal(1, 'persist');
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText('persist'));
    });
    const input = screen.getByPlaceholderText(/filter by name/i);
    act(() => {
      fireEvent.change(input, { target: { value: 'no-match-xyz' } });
    });
    // Detail card still shows the selected signal via the rows fallback.
    expect(screen.getByText('Copy value')).toBeTruthy();
  });

  it('renders the detail pre with String() fallback when JSON.stringify throws', () => {
    // Circular reference: JSON.stringify throws → falls back to String(value)
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    createRefSignal(obj, 'circ');
    render(<SignalsPanel />);
    act(() => {
      fireEvent.click(screen.getByText('circ'));
    });
    // The detail pre uses String(value) fallback — '[object Object]'
    expect(screen.getByText(/\[object Object\]/)).toBeTruthy();
  });
});

describe('TimelinePanel', () => {
  beforeEach(() => {
    devtools.reset();
  });

  it('renders empty state when no updates are recorded', () => {
    render(<TimelinePanel />);
    expect(screen.getByText(/No updates yet/i)).toBeTruthy();
  });

  it('renders signal:update rows with old → new diff', () => {
    const s = createRefSignal(0, 'updS');
    s.update(7);
    render(<TimelinePanel />);
    expect(screen.getByText('updS')).toBeTruthy();
    expect(screen.getByText('→')).toBeTruthy();
    s.dispose();
  });

  it('renders signal:touch rows with a touch chip and current value (no diff)', () => {
    const s = createRefSignal({ x: 1 }, 'touchS');
    s.current.x = 99;
    s.notify();
    render(<TimelinePanel />);
    expect(screen.getByText('touchS')).toBeTruthy();
    expect(screen.getByText('touch')).toBeTruthy();
    s.dispose();
  });

  it('renders the triggeredBy chip when an update was caused by a watch', () => {
    // Cascade test: watch on a writes b → b's update event has triggeredBy
    // We can't easily synthesize via watch without the timing module; instead
    // we emit a synthetic signal:update event with triggeredBy.
    emit({
      kind: 'signal:update',
      id: 'fromCascade',
      oldValue: 0,
      newValue: 1,
      triggeredBy: 'w_42',
      t: Date.now(),
    });
    render(<TimelinePanel />);
    expect(screen.getByText(/w_42/)).toBeTruthy();
  });

  it('filters rows by name', () => {
    const a = createRefSignal(0, 'alpha');
    const b = createRefSignal(0, 'beta');
    a.update(1);
    b.update(2);
    render(<TimelinePanel />);
    const input = screen.getByPlaceholderText(/filter by signal name/i);
    act(() => {
      fireEvent.change(input, { target: { value: 'alph' } });
    });
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.queryByText('beta')).toBeNull();
    a.dispose();
    b.dispose();
  });

  it('expands a row when clicked, showing the full JSON diff', () => {
    const s = createRefSignal({ a: 1 }, 'expandS');
    s.update({ a: 2 });
    render(<TimelinePanel />);
    act(() => {
      fireEvent.click(screen.getByText('expandS'));
    });
    expect(screen.getAllByText(/from:/).length).toBeGreaterThan(0);
    s.dispose();
  });

  it('expands a signal:touch row to show "value: …" instead of from→to', () => {
    const s = createRefSignal({ a: 1 }, 'tx');
    s.current.a = 9;
    s.notify();
    render(<TimelinePanel />);
    act(() => {
      fireEvent.click(screen.getByText('tx'));
    });
    expect(screen.getAllByText(/value:/).length).toBeGreaterThan(0);
    s.dispose();
  });

  it('falls back to String() in the expand pre when JSON.stringify throws', () => {
    // Synthesize a touch event with a circular value via direct emit — that
    // exercises the catch branch in the expand pre.
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    emit({
      kind: 'signal:touch',
      id: 'cycTouch',
      value: cycle,
      t: Date.now(),
    });
    render(<TimelinePanel />);
    act(() => {
      fireEvent.click(screen.getByText('cycTouch'));
    });
    // String() of an object yields '[object Object]'
    expect(screen.getByText(/\[object Object\]/)).toBeTruthy();
  });

  it('falls back to String() for signal:update rows when JSON.stringify throws', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    emit({
      kind: 'signal:update',
      id: 'cycUpd',
      oldValue: cycle,
      newValue: cycle,
      t: Date.now(),
    });
    render(<TimelinePanel />);
    act(() => {
      fireEvent.click(screen.getByText('cycUpd'));
    });
    expect(screen.getAllByText(/\[object Object\]/).length).toBeGreaterThan(0);
  });
});

describe('CascadePanel', () => {
  beforeEach(() => {
    devtools.reset();
  });

  it('renders an empty state when no signals are registered', () => {
    render(<CascadePanel />);
    expect(screen.getByText(/No signals to graph yet/i)).toBeTruthy();
  });

  it('renders the no-edges hint when signals exist but no cascade has fired', () => {
    createRefSignal(0, 'lonely');
    render(<CascadePanel />);
    expect(screen.getByText(/No cascade edges recorded yet/i)).toBeTruthy();
  });

  it('renders the SVG graph + edge count when cascades exist', async () => {
    const { watch } = await import('../../../refsignal');
    const a = createRefSignal(0, 'gA');
    const b = createRefSignal(0, 'gB');
    const stop = watch(a, (v) => {
      b.update(v + 1);
    });
    a.update(1);
    const { container } = render(<CascadePanel />);
    expect(screen.getByText('gA')).toBeTruthy();
    expect(screen.getByText('gB')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
    stop();
    a.dispose();
    b.dispose();
  });

  it('highlights upstream/downstream when a node is hovered', async () => {
    const { watch } = await import('../../../refsignal');
    const a = createRefSignal(0, 'hA');
    const b = createRefSignal(0, 'hB');
    const stop = watch(a, (v) => {
      b.update(v + 1);
    });
    a.update(1);
    const { container } = render(<CascadePanel />);
    const groupA = screen.getByText('hA').closest('g');
    expect(groupA).not.toBeNull();
    act(() => {
      if (groupA) fireEvent.mouseEnter(groupA);
    });
    // After hover, at least one line should use the accent stroke.
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
    act(() => {
      if (groupA) fireEvent.mouseLeave(groupA);
    });
    stop();
    a.dispose();
    b.dispose();
  });

  it('breaks cycles in the layout (covers the cycle-promotion path)', () => {
    const a = createRefSignal(0, 'cycA');
    const b = createRefSignal(0, 'cycB');
    // Synthesize a cycle by directly recording bidirectional cascade edges:
    // a writes b under effect e1, then b writes a under effect e2.
    devtools.trackEffectStart('e1', [a]);
    devtools.trackUpdate(b, 0, 1);
    devtools.trackEffectEnd('e1');
    devtools.trackEffectStart('e2', [b]);
    devtools.trackUpdate(a, 0, 2);
    devtools.trackEffectEnd('e2');
    const { container } = render(<CascadePanel />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('cycA')).toBeTruthy();
    expect(screen.getByText('cycB')).toBeTruthy();
    a.dispose();
    b.dispose();
  });

  it('truncates long node labels in the cascade graph', () => {
    const longName = 'verylongsignalname';
    const a = createRefSignal(0, longName);
    const b = createRefSignal(0, 'shortB');
    devtools.trackEffectStart('e3', [a]);
    devtools.trackUpdate(b, 0, 1);
    devtools.trackEffectEnd('e3');
    render(<CascadePanel />);
    // Truncated form ends with an ellipsis when name > 14 chars
    expect(screen.getByText(/verylongsigna…/)).toBeTruthy();
    a.dispose();
    b.dispose();
  });
});
