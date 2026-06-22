import { useRef } from 'react';
import { useRefSignalEffect } from 'react-refsignal';
import type { Joint } from '../types';

const TIP_JOINTS = new Set(['L-hand', 'R-hand', 'L-foot', 'R-foot']);

export function JointDot({
  joint,
  isHandle,
}: {
  joint: Joint;
  isHandle: boolean;
}) {
  const ref = useRef<SVGCircleElement>(null);
  useRefSignalEffect(
    () => {
      if (!ref.current) return;
      const p = joint.pos.current;
      ref.current.setAttribute('cx', p.x.toFixed(1));
      ref.current.setAttribute('cy', p.y.toFixed(1));
    },
    [joint.pos],
    { frame: true },
  );
  const p0 = joint.pos.current;
  const isHead = joint.name === 'head';
  const isTip = TIP_JOINTS.has(joint.name);
  const r = isHead ? 18 : isTip ? 11 : 9;
  const fill = isHead ? '#e2e8f0' : isTip ? '#10b981' : '#4a9eff';
  const stroke = isHandle ? '#fbbf24' : '#0f172a';
  const strokeWidth = isHandle ? 3 : 2;
  return (
    <circle
      ref={ref}
      cx={p0.x}
      cy={p0.y}
      r={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}
