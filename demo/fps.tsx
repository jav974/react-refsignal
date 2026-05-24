// FPS badge — `<FpsBadge />`, or `useFps()` for custom UI. Pass a custom pulse
// via `src`; defaults to a shared 'frame' pulse.

import { useRef, useState } from 'react';
import {
  createPulseRefSignal,
  useRefSignalEffect,
  type PulseRefSignal,
} from 'react-refsignal';

const defaultPulse = createPulseRefSignal('frame', 'fps.defaultPulse');

export function useFps(src?: PulseRefSignal): number {
  const pulse = src ?? defaultPulse;
  const [fps, setFps] = useState(0);
  const pulseRef = useRef<PulseRefSignal | null>(null);
  const stateRef = useRef({ frames: 0, last: 0 });

  useRefSignalEffect(() => {
    // First tick after mount or pulse swap — anchor `last` to the new pulse's elapsed.
    if (pulseRef.current !== pulse) {
      pulseRef.current = pulse;
      stateRef.current = { frames: 0, last: pulse.elapsed };
      return;
    }
    const s = stateRef.current;
    s.frames++;
    if (pulse.elapsed - s.last >= 1000) {
      setFps(Math.round((s.frames * 1000) / (pulse.elapsed - s.last)));
      s.frames = 0;
      s.last = pulse.elapsed;
    }
  }, [pulse]);

  return fps;
}

export function FpsBadge({ src }: { src?: PulseRefSignal }) {
  const fps = useFps(src);
  return (
    <span style={badgeStyle}>
      fps <b>{fps || '--'}</b>
    </span>
  );
}

const badgeStyle: React.CSSProperties = {
  background: '#0d1117',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'monospace',
};
