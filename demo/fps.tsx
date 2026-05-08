// demo/fps.tsx
//
// Reusable FPS badge — one shared pulse signal, one rounded-fps signal, any
// number of consumers. Drop <FpsBadge /> anywhere; or call useFps() for custom
// UI.
//
// The pulse subscription is ref-counted by consumer mounts: zero consumers ⇒
// no watcher ⇒ pulse subscriber count stays at zero ⇒ pulse doesn't tick. The
// first useFps() mount installs the watcher; the last unmount tears it down.

import { useEffect } from 'react';
import {
  createPulseRefSignal,
  createRefSignal,
  useRefSignalRender,
  watch,
} from 'react-refsignal';

const fpsSignal = createRefSignal(0);
const frame = createPulseRefSignal('raf');

let consumers = 0;
let stopWatching: (() => void) | null = null;

function startWatching(): () => void {
  let frames = 0;
  let lastSampleAt = 0;
  return watch(frame, () => {
    frames++;
    const windowMs = frame.elapsed - lastSampleAt;
    if (windowMs >= 1000) {
      fpsSignal.update(Math.round((frames * 1000) / windowMs));
      frames = 0;
      lastSampleAt = frame.elapsed;
    }
  });
}

export function useFps(): number {
  useEffect(() => {
    if (consumers === 0) stopWatching = startWatching();
    consumers++;
    return () => {
      consumers--;
      if (consumers === 0) {
        stopWatching?.();
        stopWatching = null;
      }
    };
  }, []);
  useRefSignalRender([fpsSignal]);
  return fpsSignal.current;
}

export function FpsBadge() {
  const fps = useFps();
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
