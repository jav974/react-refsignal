// Skeleton — position-based humanoid ragdoll. Joints are the state; bones
// are length + angle constraints between joints. The body is a tree
// (spine + head, two arms, two legs) — see BONE_SPEC in logic/ik.ts.
//
// Exactly one joint is pinned per frame — the selected handle, which follows
// the mouse cursor exactly. Everything else floats and falls under gravity,
// constrained by bone length + angle limits.
//
// Press ← / → to cycle the handle through every joint (pelvis ↔ chest ↔
// head ↔ L-arm ↔ R-arm ↔ L-leg ↔ R-leg).

import { useEffect, useMemo, useRef } from 'react';
import {
  createRefSignal,
  usePulseRefSignal,
  useRefSignalEffect,
  useRefSignalRender,
} from 'react-refsignal';
import { CodeChip } from '../../common/components/CodeChip';
import { BoneSegment } from './components/BoneSegment';
import { BonesPanel } from './components/BonesPanel';
import { JointDot } from './components/JointDot';
import { TargetMarker } from './components/TargetMarker';
import {
  INITIAL_HANDLE_INDEX,
  MIN_HANDLE_INDEX,
  makeBody,
  step,
} from './logic/ik';
import type { Point } from './types';
import { legendStyle, pageStyle, svgStyle } from './styles/skeleton.styles';

export default function Skeleton() {
  // Component-scope pulse — disposes automatically on unmount (no leaks
  // across route changes). Drives the verlet+constraint step below.
  const framePulse = usePulseRefSignal('frame', 'skeleton.framePulse');
  const body = useMemo(makeBody, []);
  const { joints, bones, jointParent } = body;
  const target = useMemo(
    () => createRefSignal({ x: 540, y: 240 } as Point, 'skeleton.target'),
    [],
  );
  const svgRef = useRef<SVGSVGElement>(null);

  const handleIndex = useMemo(
    () => createRefSignal(INITIAL_HANDLE_INDEX, 'skeleton.handleIndex'),
    [],
  );
  useRefSignalRender([handleIndex]);

  // Dispose all body-scoped signals on unmount — `useMemo(createRefSignal)`
  // doesn't auto-dispose. Same goes for the per-joint `pos` and per-bone
  // `stuck` signals built inside `makeBody`. Without this, every route change
  // would leak ~30 signal entries to devtools.
  useEffect(() => {
    return () => {
      target.dispose();
      handleIndex.dispose();
      for (const j of joints) j.pos.dispose();
      for (const b of bones) b.stuck.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bound to mount lifetime; body memos are stable for the component
  }, []);

  // Mouse → target signal. Mutate + notify (no fresh {x, y} per event).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      target.current.x = ((e.clientX - r.left) / r.width) * vb.width;
      target.current.y = ((e.clientY - r.top) / r.height) * vb.height;
      target.notify();
    };
    svg.addEventListener('pointermove', onMove);
    return () => {
      svg.removeEventListener('pointermove', onMove);
    };
  }, [target]);

  // Arrow keys → handle index.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handleIndex.update(Math.max(MIN_HANDLE_INDEX, handleIndex.current - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        handleIndex.update(Math.min(bones.length - 1, handleIndex.current + 1));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [bones.length, handleIndex]);

  // Drive physics each frame.
  useRefSignalEffect(() => {
    step(joints, bones, handleIndex.current, target.current);
  }, [framePulse]);

  const currentHandleIndex = handleIndex.current;
  const handleJointIdx = currentHandleIndex + 1;

  return (
    <div style={pageStyle}>
      <div style={legendStyle}>
        A humanoid ragdoll built from joints (state) and bones (length + angle
        constraints). Each frame: verlet integration, then interleaved length /
        angle relaxation. The body is a tree — arms and legs both branch off the
        spine. The selected joint IS the mouse position; the rest of the body
        dangles under gravity. Press <CodeChip>←</CodeChip> /{' '}
        <CodeChip>→</CodeChip> to cycle the handle through every joint (pelvis
        ↔ chest ↔ head ↔ left arm ↔ right arm ↔ left leg ↔ right leg).
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 1000 560"
        preserveAspectRatio="xMidYMid meet"
        style={svgStyle}
      >
        <TargetMarker target={target} />

        {bones.map((b) => (
          <BoneSegment key={b.name} bone={b} joints={joints} />
        ))}

        {joints.map((j, i) => (
          <JointDot key={j.name} joint={j} isHandle={i === handleJointIdx} />
        ))}
      </svg>

      <BonesPanel
        bones={bones}
        joints={joints}
        jointParent={jointParent}
        currentHandleIndex={currentHandleIndex}
      />
    </div>
  );
}
