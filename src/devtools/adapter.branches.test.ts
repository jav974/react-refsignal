import { createRefSignal } from '../refsignal';
import { devtools } from './adapter';

describe('RefSignalDevTools — fallback / edge branches', () => {
  beforeEach(() => {
    devtools.reset();
  });

  afterEach(() => {
    devtools.configure({ maxHistory: 100, maxEvents: 500 });
  });

  it('records an "unknown" touch when notifying an unregistered signal', () => {
    const s = createRefSignal(0, 'gone');
    s.dispose(); // unregisters from the adapter
    devtools.trackNotify(s);
    const touch = devtools.getEvents().find((e) => e.kind === 'signal:touch');
    expect(touch).toBeDefined();
    expect(touch?.id).toBe('unknown');
  });

  it('maps an unregistered effect dependency to "unknown"', () => {
    const dep = createRefSignal(0, 'depGone');
    dep.dispose();
    devtools.trackEffectStart('eUnknown', [dep]);
    devtools.trackEffectEnd('eUnknown');
    const start = devtools.getEvents().find((e) => e.kind === 'effect:start');
    expect(start?.depIds).toEqual(['unknown']);
  });

  it('emit() evicts the oldest event when the ring overflows', () => {
    devtools.configure({ maxEvents: 5 });
    for (let i = 0; i < 8; i++) {
      devtools.emit({ kind: 'signal:register', id: `s${String(i)}`, t: i });
    }
    const events = devtools.getEvents();
    expect(events.length).toBe(5);
    expect(events.some((e) => e.id === 's0')).toBe(false);
    expect(events.some((e) => e.id === 's7')).toBe(true);
  });

  it('trackNotify evicts the oldest event when the ring overflows', () => {
    devtools.configure({ maxEvents: 3 });
    for (let i = 0; i < 3; i++) {
      devtools.emit({ kind: 'signal:register', id: `r${String(i)}`, t: i });
    }
    const s = createRefSignal(0, 'touchy');
    devtools.trackNotify(s); // pushes a touch → length 4 > 3 → shift
    expect(devtools.getEvents().length).toBe(3);
  });

  it('uses the "pulse?" placeholder for a pulse tick with no signal', () => {
    devtools.emit({
      kind: 'pulse:tick',
      dt: 16,
      fps: 60,
      tickCount: 1,
      elapsed: 16,
      t: 1,
    });
    expect(devtools.getPulseStates()[0]?.pulseId).toBe('pulse?');
  });

  it('uses the "pulse?" placeholder for a pulse tick from an unregistered signal', () => {
    const p = createRefSignal(0, 'pGone');
    p.dispose();
    devtools.emit({ kind: 'pulse:tick', signal: p, dt: 16, fps: 60, t: 1 });
    expect(devtools.getPulseStates()[0]?.pulseId).toBe('pulse?');
  });

  it('keeps the prior tickCount/elapsed when a later tick omits them', () => {
    const p = createRefSignal(0, 'pTick');
    devtools.emit({
      kind: 'pulse:tick',
      signal: p,
      dt: 16,
      fps: 60,
      tickCount: 5,
      elapsed: 80,
      t: 1,
    });
    // Second tick omits tickCount + elapsed → existing values are retained.
    devtools.emit({ kind: 'pulse:tick', signal: p, dt: 16, fps: 60, t: 2 });
    const state = devtools.getPulseStates().find((s) => s.pulseId === 'pTick');
    expect(state?.tickCount).toBe(5);
    expect(state?.elapsedMs).toBe(80);
    expect(state?.recent.length).toBe(2);
    p.dispose();
  });

  it('uses the "pulse?" placeholder for a pulse:state with no signal', () => {
    devtools.emit({ kind: 'pulse:state', state: 'paused', t: 1 });
    expect(devtools.getPulseStates()[0]?.pulseId).toBe('pulse?');
  });

  it('uses the "pulse?" placeholder for a pulse:state from an unregistered signal', () => {
    const p = createRefSignal(0, 'pStateGone');
    p.dispose();
    devtools.emit({ kind: 'pulse:state', signal: p, state: 'stopped', t: 1 });
    expect(devtools.getPulseStates()[0]?.pulseId).toBe('pulse?');
  });

  it('keeps the prior state/tickCount/elapsed when a pulse:state omits them', () => {
    const p = createRefSignal(0, 'pState');
    devtools.emit({
      kind: 'pulse:state',
      signal: p,
      state: 'paused',
      tickCount: 7,
      elapsed: 120,
      t: 1,
    });
    // A later event omits state + tickCount + elapsed → existing values stick.
    devtools.emit({ kind: 'pulse:state', signal: p, t: 2 });
    const state = devtools.getPulseStates().find((s) => s.pulseId === 'pState');
    expect(state?.state).toBe('paused');
    expect(state?.tickCount).toBe(7);
    expect(state?.elapsedMs).toBe(120);
    p.dispose();
  });

  it('drops the sparkline samples when a pulse:state reports stopped', () => {
    const p = createRefSignal(0, 'pStopClear');
    // Seed a sample via a tick, then stop — recent must be cleared.
    devtools.emit({
      kind: 'pulse:tick',
      signal: p,
      dt: 16,
      fps: 60,
      tickCount: 1,
      elapsed: 16,
      t: 1,
    });
    expect(
      devtools.getPulseStates().find((s) => s.pulseId === 'pStopClear')?.recent
        .length,
    ).toBe(1);
    devtools.emit({ kind: 'pulse:state', signal: p, state: 'stopped', t: 2 });
    expect(
      devtools.getPulseStates().find((s) => s.pulseId === 'pStopClear')?.recent
        .length,
    ).toBe(0);
    p.dispose();
  });

  it('applies defaults for omitted broadcast channel fields', () => {
    devtools.emit({ kind: 'broadcast:peers', channel: 'bare', t: 1 });
    const ch = devtools
      .getBroadcastChannels()
      .find((c) => c.channel === 'bare');
    expect(ch).toMatchObject({
      isBroadcaster: false,
      isStable: false,
      peerCount: 0,
      peers: [],
    });
  });

  it('ignores a broadcast:peers event that carries no channel', () => {
    devtools.emit({ kind: 'broadcast:peers', t: 1 });
    expect(devtools.getBroadcastChannels().length).toBe(0);
  });

  it('falls back to the default ring size when maxEvents is unset', () => {
    devtools.configure({ maxEvents: undefined });
    devtools.emit({ kind: 'signal:register', id: 'x', t: 1 }); // emit() ?? 500
    const s = createRefSignal(0, 'unset');
    devtools.trackNotify(s); // trackNotify() ?? 500
    expect(devtools.getEvents().length).toBeGreaterThan(0);
  });
});
