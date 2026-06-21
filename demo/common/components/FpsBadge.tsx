// FPS badge — `<FpsBadge />`, or `useFps()` for custom UI. Pass a custom pulse
// via `src`; defaults to the shared 'frame' pulse.

import type { CSSProperties } from 'react';
import type { PulseRefSignal } from 'react-refsignal';
import { useFps } from '../hooks/useFps';

export function FpsBadge({ src }: { src?: PulseRefSignal }) {
  const fps = useFps(src);
  return (
    <span style={badgeStyle}>
      fps <b>{fps || '--'}</b>
    </span>
  );
}

const badgeStyle: CSSProperties = {
  background: '#0d1117',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'monospace',
};
