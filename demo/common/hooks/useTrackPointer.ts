import { useEffect } from 'react';
import { useRefSignal, type ReadonlyRefSignal } from 'react-refsignal';

type XY = { x: number; y: number };

// Tracks the global pointer position into a signal it owns, and returns a
// read-only view — the window listener is the only writer. Adds a window
// listener that writes `{ clientX, clientY }` on every move and removes it on
// unmount. `initial` seeds the pre-move value (e.g. an off-screen sentinel).
// `pointermove` also fires for touch + pen. This is the recurring "window
// listener → position signal" wiring behind the heartbeat and comet demos.
export function useTrackPointer({
  initial = { x: 0, y: 0 },
  name,
}: {
  initial?: XY;
  name?: string;
} = {}): ReadonlyRefSignal<XY> {
  const target = useRefSignal(initial, name);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      target.update({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [target]);

  return target;
}
