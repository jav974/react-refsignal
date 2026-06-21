import { useRef } from 'react';
import { useRefSignalEffect } from 'react-refsignal';
import type { Bone, Joint } from '../types';

export function BoneSegment({ bone, joints }: { bone: Bone; joints: Joint[] }) {
  const lineRef = useRef<SVGLineElement>(null);
  const start = joints[bone.startIdx];
  const end = joints[bone.endIdx];

  // No `frame: true` — we want the bone to track the handle joint exactly,
  // with no 1-frame rAF-coalesce lag. The synchronous render runs many times
  // per frame (once per constraint update) but only the final attribute set
  // matters for the next paint, so cost is dominated by JS calls (fine for
  // a 10-bone demo).
  useRefSignalEffect(() => {
    if (!lineRef.current) return;
    const a = start.pos.current;
    const b = end.pos.current;
    lineRef.current.setAttribute('x1', a.x.toFixed(1));
    lineRef.current.setAttribute('y1', a.y.toFixed(1));
    lineRef.current.setAttribute('x2', b.x.toFixed(1));
    lineRef.current.setAttribute('y2', b.y.toFixed(1));
  }, [start.pos, end.pos]);

  useRefSignalEffect(() => {
    if (!lineRef.current) return;
    lineRef.current.setAttribute(
      'stroke',
      bone.stuck.current ? '#ef4444' : '#cbd5e1',
    );
  }, [bone.stuck]);

  const a0 = start.pos.current;
  const b0 = end.pos.current;
  return (
    <line
      ref={lineRef}
      x1={a0.x}
      y1={a0.y}
      x2={b0.x}
      y2={b0.y}
      stroke="#cbd5e1"
      strokeWidth={7}
      strokeLinecap="round"
    />
  );
}
