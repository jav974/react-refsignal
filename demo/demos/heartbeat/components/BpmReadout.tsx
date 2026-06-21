import { useRefSignalRender, type ReadonlyRefSignal } from 'react-refsignal';
import { bpmStyle } from '../styles/heartbeat.styles';

// Subscribes to the derived heart-rate signal and renders just the bpm number.
// Isolating the only rate-dependent view here means a rate change re-renders
// this node alone — the parent Heartbeat wires its signals + the updatePulse
// effect once at mount and never re-renders. `frame: true` coalesces the
// mousemove fan-out into one render per frame.
export function BpmReadout({ rate }: { rate: ReadonlyRefSignal<number> }) {
  useRefSignalRender([rate], { frame: true });
  const bpm = Math.round(60000 / rate.current);
  return <div style={bpmStyle}>{bpm} bpm</div>;
}
