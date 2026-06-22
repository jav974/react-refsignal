import { useRef } from 'react';
import { useRefSignalEffect, type RefSignal } from 'react-refsignal';
import type { Point } from '../types';

export function TargetMarker({ target }: { target: RefSignal<Point> }) {
  const ref = useRef<SVGCircleElement>(null);
  useRefSignalEffect(() => {
    const t = target.current;
    if (ref.current) {
      ref.current.setAttribute('cx', t.x.toFixed(1));
      ref.current.setAttribute('cy', t.y.toFixed(1));
    }
  }, [target]);
  const initial = target.current;
  return (
    <circle
      ref={ref}
      cx={initial.x}
      cy={initial.y}
      r={14}
      fill="none"
      stroke="#fbbf24"
      strokeWidth={2}
      strokeDasharray="5 4"
      pointerEvents="none"
    />
  );
}
