import { devtools, type PulseSample } from '../../adapter';
import * as s from '../styles';
import { useDevtoolsRender } from '../useDevtoolsRender';

const Sparkline = ({ samples }: { samples: PulseSample[] }) => {
  const w = 200;
  const h = 40;
  if (samples.length < 2) {
    return (
      <svg width={w} height={h} style={s.sparkline}>
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          fill={s.colors.textMuted}
          fontSize={10}
        >
          warming up…
        </text>
      </svg>
    );
  }
  // Scale the y-axis to the highest fps observed in the window, so a frame
  // pulse self-fits its display's refresh rate (60 / 120 / 144Hz) instead of a
  // hardcoded baseline. Falls back to 1 for an all-zero / empty window (÷0).
  const peak = Math.max(...samples.map((sa) => sa.fps));
  const max = peak > 0 ? peak : 1;
  const min = 0;
  const points = samples
    .map((sa, i) => {
      const x = (i / (samples.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((sa.fps - min) / (max - min)) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} style={s.sparkline}>
      <polyline
        fill="none"
        stroke={s.colors.accent}
        strokeWidth={1.5}
        points={points}
      />
    </svg>
  );
};

export function PulsePanel() {
  useDevtoolsRender();
  const pulses = devtools.getPulseStates();

  if (pulses.length === 0) {
    return (
      <div style={s.empty}>
        No active pulse signals.{' '}
        <span style={{ color: s.colors.textMuted }}>
          Use <code>createPulseRefSignal</code> or{' '}
          <code>usePulseRefSignal</code>.
        </span>
      </div>
    );
  }

  return (
    <div>
      {pulses.map((p) => {
        const lastFps = p.recent[p.recent.length - 1]?.fps;
        const control = devtools.getPulseControl(p.pulseId);
        const stateColor =
          p.state === 'active'
            ? s.colors.success
            : p.state === 'paused'
              ? s.colors.warn
              : s.colors.error;
        return (
          <div key={p.pulseId} style={s.card}>
            <div
              style={{
                ...s.cardTitle,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{p.pulseId}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={s.chip(stateColor)}>{p.state}</span>
                <span style={s.chip(s.colors.accentDim)}>
                  {lastFps !== undefined ? `${lastFps.toFixed(1)} fps` : '—'}
                </span>
              </span>
            </div>
            {control && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {p.state === 'active' ? (
                  <button
                    style={s.controlBtn}
                    onClick={() => {
                      control.pause();
                    }}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    style={s.controlBtn}
                    onClick={() => {
                      control.resume();
                    }}
                  >
                    Resume
                  </button>
                )}
                {p.state !== 'stopped' && (
                  <button
                    style={s.controlBtn}
                    onClick={() => {
                      control.stop();
                    }}
                  >
                    Stop
                  </button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <Sparkline samples={p.recent} />
              <div style={{ flex: 1 }}>
                <div style={s.cardRow}>
                  <span style={s.cardLabel}>Ticks</span>
                  <span>{p.tickCount}</span>
                </div>
                <div style={s.cardRow}>
                  <span style={s.cardLabel}>Elapsed</span>
                  <span>{(p.elapsedMs / 1000).toFixed(1)}s</span>
                </div>
                <div style={s.cardRow}>
                  <span style={s.cardLabel}>Avg dt</span>
                  <span>
                    {p.recent.length > 0
                      ? `${(
                          p.recent.reduce((a, b) => a + b.dt, 0) /
                          p.recent.length
                        ).toFixed(2)}ms`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
