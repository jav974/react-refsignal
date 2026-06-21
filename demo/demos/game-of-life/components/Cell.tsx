// DOM-mode cell: subscribes to one signal and paints `style.background`
// imperatively. React renders this once at mount; the signal does the rest —
// so the renders/s counter (bumped here, drained by the page via takeRenders)
// reads ~0 once running, no matter the grid size.

import { memo, useRef } from 'react';
import { useRefSignalEffect, type RefSignal } from 'react-refsignal';
import { ageColor } from '../logic/color';

let _cellRenders = 0;

export function takeRenders(): number {
  const r = _cellRenders;
  _cellRenders = 0;
  return r;
}

export const Cell = memo(function Cell({
  sig,
  onPaint,
}: {
  sig: RefSignal<number>;
  onPaint: (sig: RefSignal<number>) => void;
}) {
  _cellRenders++;
  const ref = useRef<HTMLDivElement>(null);
  // Imperative paint — React renders this once at mount, the signal does the rest.
  useRefSignalEffect(() => {
    const el = ref.current;
    if (el) el.style.background = ageColor(sig.current);
  }, [sig]);
  return (
    <div
      ref={ref}
      onPointerDown={() => {
        onPaint(sig);
      }}
      onPointerEnter={(e) => {
        if (e.buttons === 1) onPaint(sig);
      }}
      style={{ background: ageColor(sig.current) }}
    />
  );
});
