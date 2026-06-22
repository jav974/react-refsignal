// The floating BONES panel: one row per bone showing its live local angle and
// limit range, plus the current handle joint and frame rate. Rows recolor to
// red while their bone is STUCK (angle-limited) and dim while "free" (hanging
// downstream of the handle).

import { useRef } from 'react';
import { useRefSignalEffect } from 'react-refsignal';
import { FpsBadge } from '../../../common/components/FpsBadge';
import { isBoneDownstream, MIN_HANDLE_INDEX } from '../logic/ik';
import type { Bone, Joint } from '../types';
import {
  col0,
  col1,
  handleArrow,
  nameCell,
  panelHeading,
  panelStyle,
  rowStyle,
} from '../styles/skeleton.styles';

export function BonesPanel({
  bones,
  joints,
  jointParent,
  currentHandleIndex,
}: {
  bones: Bone[];
  joints: Joint[];
  jointParent: number[];
  currentHandleIndex: number;
}) {
  const handleJointIdx = currentHandleIndex + 1;
  const handleJoint = joints[handleJointIdx];

  return (
    <div style={panelStyle}>
      <div style={panelHeading}>BONES</div>
      <RootRow isHandle={currentHandleIndex === MIN_HANDLE_INDEX} />
      {bones.map((b, i) => (
        <BoneRow
          key={b.name}
          bone={b}
          joints={joints}
          isHandle={i === currentHandleIndex}
          isFree={isBoneDownstream(b.startIdx, handleJointIdx, jointParent)}
        />
      ))}
      <div style={{ ...rowStyle, marginTop: 10, opacity: 0.8 }}>
        <span style={col0}>handle joint</span>
        <span
          style={{
            ...col1,
            fontFamily: 'monospace',
            color: '#fbbf24',
            fontSize: 11,
          }}
        >
          {handleJoint.name}
        </span>
      </div>
      <div style={{ ...rowStyle, marginTop: 4, opacity: 0.8 }}>
        <span style={col0}>frame rate</span>
        <FpsBadge />
      </div>
    </div>
  );
}

function RootRow({ isHandle }: { isHandle: boolean }) {
  return (
    <div style={rowStyle}>
      <span style={nameCell}>
        <span style={handleArrow}>{isHandle ? '◀' : ''}</span>
        <span style={{ opacity: 0.7, fontStyle: 'italic' }}>(root)</span>
      </span>
      <span
        style={{
          ...col1,
          fontFamily: 'monospace',
          opacity: 0.35,
          fontSize: 11,
        }}
      >
        —
      </span>
      <span
        style={{
          ...col1,
          fontFamily: 'monospace',
          opacity: 0.35,
          fontSize: 10,
        }}
      >
        joint
      </span>
    </div>
  );
}

function BoneRow({
  bone,
  joints,
  isHandle,
  isFree,
}: {
  bone: Bone;
  joints: Joint[];
  isHandle: boolean;
  isFree: boolean;
}) {
  const valRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const start = joints[bone.startIdx];
  const end = joints[bone.endIdx];
  const parentStart = bone.parent ? joints[bone.parent.startIdx] : null;
  const parentEnd = bone.parent ? joints[bone.parent.endIdx] : null;

  const angleDeps = parentStart
    ? [start.pos, end.pos, parentStart.pos, parentEnd!.pos]
    : [start.pos, end.pos];

  useRefSignalEffect(
    () => {
      if (!valRef.current) return;
      const parentTheta = parentStart
        ? Math.atan2(
            parentEnd!.pos.current.y - parentStart.pos.current.y,
            parentEnd!.pos.current.x - parentStart.pos.current.x,
          )
        : 0;
      const ownTheta = Math.atan2(
        end.pos.current.y - start.pos.current.y,
        end.pos.current.x - start.pos.current.x,
      );
      let localDeg =
        ((ownTheta - parentTheta) * 180) / Math.PI - bone.restOffset;
      while (localDeg > 180) localDeg -= 360;
      while (localDeg < -180) localDeg += 360;
      valRef.current.textContent = localDeg.toFixed(0) + '°';
    },
    angleDeps,
    { frame: true },
  );

  useRefSignalEffect(() => {
    if (rowRef.current) {
      rowRef.current.style.color = bone.stuck.current ? '#ef4444' : '#e2e8f0';
    }
  }, [bone.stuck]);

  return (
    <div ref={rowRef} style={rowStyle}>
      <span style={nameCell}>
        <span style={handleArrow}>{isHandle ? '◀' : ''}</span>
        <span style={{ opacity: isFree ? 0.45 : 1 }}>{bone.name}</span>
      </span>
      <span
        ref={valRef}
        style={{
          ...col1,
          fontFamily: 'monospace',
          fontWeight: 600,
          opacity: isFree ? 0.45 : 1,
        }}
      >
        0°
      </span>
      <span
        style={{ ...col1, fontFamily: 'monospace', opacity: 0.5, fontSize: 10 }}
      >
        [{bone.min}°, {bone.max}°]
      </span>
    </div>
  );
}
