// `useFps()` — instantaneous frame rate sampled off a pulse signal. Pass a
// custom pulse via `src`; defaults to a shared 'frame' pulse so every consumer
// agrees on the same clock.

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
