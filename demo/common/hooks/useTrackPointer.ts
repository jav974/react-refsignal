import { useEffect } from 'react';
import { useRefSignal, type ReadonlyRefSignal } from 'react-refsignal';

type XY = { x: number; y: number };

// Tracks the global pointer position into a signal it owns, and returns a
// read-only view — the window listener is the only writer. Adds a window
// listener that writes `{ clientX, clientY }` on every move and removes it on
// unmount. `initial` seeds the pre-move value (e.g. an off-screen sentinel);
// `event` defaults to `pointermove` (also fires for touch + pen). This is the
// recurring "window listener → position signal" wiring behind the heartbeat
// and comet demos.
export function useTrackPointer({
  initial = { x: 0, y: 0 },
  name,
  event = 'pointermove',
}: {
  initial?: XY;
  name?: string;
  event?: 'pointermove' | 'mousemove';
} = {}): ReadonlyRefSignal<XY> {
  const target = useRefSignal(initial, name);

  useEffect(() => {
    // PointerEvent extends MouseEvent, so clientX/clientY exist either way.
    const onMove = (e: Event) => {
      const { clientX, clientY } = e as MouseEvent;
      target.update({ x: clientX, y: clientY });
    };
    window.addEventListener(event, onMove);
    return () => {
      window.removeEventListener(event, onMove);
    };
  }, [target, event]);

  return target;
}
