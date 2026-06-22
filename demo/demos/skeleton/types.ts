import type { RefSignal } from 'react-refsignal';

export type Point = { x: number; y: number };

export type Joint = {
  name: string;
  pos: RefSignal<Point> & { dispose: () => void };
  // Previous-frame position. Mutable plain field — verlet velocity = pos - prev.
  prev: Point;
};

export type Bone = {
  name: string;
  length: number;
  min: number;
  max: number;
  // Local-angle reference offset (degrees). When non-zero, the bone's local
  // angle = (own absolute - parent absolute) - restOffset. Use it so branch
  // bones (arm/leg off the spine) have local angle ~0 in rest pose instead
  // of ±180 — otherwise the [min,max] check straddles the wraparound and
  // becomes ambiguous.
  restOffset: number;
  parent: Bone | null;
  startIdx: number; // index into joints[] (= pivot)
  endIdx: number; // index into joints[] (= outgoing tip)
  // True when angle-limit enforcement clamped this bone this frame.
  stuck: RefSignal<boolean> & { dispose: () => void };
};

export interface BoneSpec {
  name: string;
  endJoint: string;
  // Bone whose direction defines this bone's angle reference. null for spine.
  parentName: string | null;
  // Joint this bone starts from. Defaults to parent's endJoint (or 'pelvis'
  // if no parent). Override for legs, which START from the pelvis even
  // though their angle parent is the spine.
  startJoint?: string;
  length: number;
  // Initial local angle (degrees) — see Bone.restOffset.
  angle: number;
  min: number; // local-angle lower limit
  max: number; // local-angle upper limit
  restOffset: number;
}
