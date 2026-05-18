// Heartbeat — pulse rate driven by mouse distance.
//
// The circle pulses faster as the cursor gets closer, slower as it moves away.
// Cadence flows through the reactive graph: mouse position → derived rate
// signal → `updatePulse(rate.current)`. No setInterval, no useEffect timers.

import { useEffect, useRef } from 'react';
import {
  usePulseRefSignal,
  useRefSignal,
  useRefSignalEffect,
  useRefSignalMemo,
  useRefSignalRender,
} from 'react-refsignal';

const MIN_MS = 200;
const MAX_MS = 2000;
const FAR_PX = 600;

// Distance → ms interval. Linear ramp clamped to [MIN_MS, MAX_MS]. PulseRate
// accepts `number` directly, so no template-literal cast needed.
function rateFromDistance(d: number): number {
  const t = Math.min(1, d / FAR_PX);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

export default function Heartbeat() {
  const mouse = useRefSignal({ x: 0, y: 0 });
  const circleRef = useRef<HTMLDivElement>(null);
  const center = useRef({ x: 0, y: 0 });

  // Initial cadence is the resting rate; updatePulse below wires it to the
  // computed `heartRate` so cadence becomes reactive data.
  const heart = usePulseRefSignal(MAX_MS);

  // Derived rate: mouse-to-circle distance → ms interval.
  const heartRate = useRefSignalMemo(() => {
    const dx = mouse.current.x - center.current.x;
    const dy = mouse.current.y - center.current.y;
    return rateFromDistance(Math.hypot(dx, dy));
  }, [mouse]);

  // On each tick: bump animation that fills the full beat, then adapt the rate
  // for the NEXT beat. Animation duration uses `heartRate.current` (not
  // `heart.dt`) — same value we pass to `updatePulse`, so the animation ends
  // exactly when the next tick fires. Using `heart.dt` would be the old rate,
  // mismatching the new interval and causing flicker across rate changes.
  useRefSignalEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.animate(
      [
        { transform: 'scale(1) translateY(0)' },
        { transform: 'scale(1.35) translateY(-10px)', offset: 0.2 },
        { transform: 'scale(1) translateY(0)' },
      ],
      { duration: heartRate.current, easing: 'ease-out' },
    );
    heart.updatePulse(heartRate.current);
  }, [heart]);

  // Badge re-renders on rate change. frame coalesces the mousemove fan-out.
  useRefSignalRender([heartRate], { frame: true });

  // Mouse tracking.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.update({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
    };
  }, [mouse]);

  // Measure circle center on mount + resize.
  useEffect(() => {
    const measure = () => {
      const el = circleRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);

  const bpm = Math.round(60000 / heartRate.current);

  return (
    <div style={pageStyle}>
      <div
        ref={circleRef}
        style={{
          width: 140,
          height: 140,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 35% 30%, #ff7b8b, #c92a3a 60%, #7a0a16)',
          boxShadow:
            '0 0 60px rgba(255, 107, 107, 0.45), inset 0 0 30px rgba(0,0,0,0.2)',
          willChange: 'transform',
        }}
      />

      <div style={infoBlock}>
        <div style={bpmStyle}>{bpm} bpm</div>
        <div style={hintStyle}>
          Move closer to make the heart race; further away to calm it down.
        </div>
      </div>

      <div style={legendStyle}>
        <code style={codeStyle}>useRefSignalMemo</code> derives a{' '}
        <code style={codeStyle}>PulseRate</code> from the mouse signal;{' '}
        <code style={codeStyle}>useRefSignalEffect</code> calls{' '}
        <code style={codeStyle}>heart.updatePulse(heartRate.current)</code>.
        Cadence is data — it flows through the reactive graph.
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  background:
    'radial-gradient(ellipse at center, #2a1020 0%, #0d0716 70%, #06030f 100%)',
  color: '#fff',
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  gap: 28,
  fontFamily: 'system-ui, sans-serif',
  padding: 24,
};

const infoBlock: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
};

const bpmStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: 1,
  color: '#ff8a9c',
  textShadow: '0 0 20px rgba(255, 107, 107, 0.5)',
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.7,
  maxWidth: 320,
  textAlign: 'center',
};

const legendStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 64,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 12,
  opacity: 0.55,
  maxWidth: 540,
  textAlign: 'center',
  lineHeight: 1.6,
};

const codeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 11,
  background: 'rgba(255,255,255,0.1)',
};
