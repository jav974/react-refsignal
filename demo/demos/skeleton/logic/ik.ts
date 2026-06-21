// Position-based dynamics for the ragdoll: rest-pose construction (makeBody),
// the per-frame solver (step), and the downstream-bone test used to dim
// "free" bones in the panel.
//
// Each frame, driven by a shared rAF pulse:
//   1. Verlet integrate non-pinned joints (gravity + damped momentum).
//   2. Pin enforcement — handle joint is snapped to the mouse.
//   3. Constraint relaxation. Each iteration runs a length pass and an angle
//      pass over all bones. The angle pass rotates using the bone's REST
//      length, so it acts as a length correction along the clamped
//      direction — both constraints converge together. When the end joint is
//      pinned the angle is enforced by moving the START joint along the
//      clamped direction (CCD-style); without this, the handle bone would
//      bend past its limit because the end can't move.
//   4. `bone.stuck` is updated from the final pose, and CANCEL is applied
//      (prev = pos) to joints in stuck bones — kills the verlet rebound
//      that otherwise turns angle limits into a vibration source.

import { createRefSignal } from 'react-refsignal';
import type { Bone, BoneSpec, Joint, Point } from '../types';

// Pelvis sits here in the rest pose used to forward-kinematics the body
// on mount. Once the demo is running, only the handle joint is pinned
// (to the mouse) — everything else floats.
const ORIGIN: Point = { x: 300, y: 280 };

// Initial handle index — overridden at runtime by ← / → arrow keys.
// Range: -1 (root = pelvis) to bones.length - 1 (each bone's tip).
// HANDLE_OUT_IDX (= handleIndex + 1) is the joint index pinned to the mouse.
// Bones are listed top-down so the cycle reads as pelvis → chest → head →
// L-arm → R-arm → L-leg → R-leg.
export const MIN_HANDLE_INDEX = -1;
export const INITIAL_HANDLE_INDEX = 3; // L-farm bone → L-hand joint

// Physics tuning.
const GRAVITY = 0.5; // px/frame² (downward in SVG coords)
const DAMPING = 0.985; // velocity retention per frame (1 = no friction)
const CONSTRAINT_ITERATIONS = 96; // length+angle iterations per frame

function makeJoint(name: string, pos: Point): Joint {
  return {
    name,
    pos: createRefSignal({ x: pos.x, y: pos.y } as Point),
    prev: { x: pos.x, y: pos.y },
  };
}

// Topological order: each bone's parent appears earlier. Bone array index i
// places the bone's end joint at joints[i + 1], so the handle-index → joint
// mapping (HANDLE_OUT_IDX = handleIndex + 1) keeps working.
//
// Limit convention: bones with `min=-360, max=360` are effectively
// unconstrained — local angle is always inside the range, so the angle
// pass skips them and STUCK never fires (= no CANCEL). Use this for ball
// joints (shoulder, hip). Hinge joints (elbow, knee) have a narrow range;
// keep their rest `angle` strictly inside the range so the body doesn't sit
// on a STUCK boundary at rest (which would kill verlet velocity from
// gravity and freeze natural motion).
const BONE_SPEC: BoneSpec[] = [
  // Trunk
  {
    name: 'spine',
    endJoint: 'chest',
    parentName: null,
    length: 130,
    angle: 0,
    min: -75,
    max: 75,
    restOffset: -90,
  },
  {
    name: 'head',
    endJoint: 'head',
    parentName: 'spine',
    length: 60,
    angle: 0,
    min: -55,
    max: 55,
    restOffset: 0,
  },
  // Left arm — ball-joint shoulder, hinge elbow.
  {
    name: 'L-uarm',
    endJoint: 'L-elbow',
    parentName: 'spine',
    length: 95,
    angle: 25,
    min: -360,
    max: 360,
    restOffset: 180,
  },
  {
    name: 'L-farm',
    endJoint: 'L-hand',
    parentName: 'L-uarm',
    length: 80,
    angle: -15,
    min: -150,
    max: 5,
    restOffset: 0,
  },
  // Right arm
  {
    name: 'R-uarm',
    endJoint: 'R-elbow',
    parentName: 'spine',
    length: 95,
    angle: -25,
    min: -360,
    max: 360,
    restOffset: 180,
  },
  {
    name: 'R-farm',
    endJoint: 'R-hand',
    parentName: 'R-uarm',
    length: 80,
    angle: 15,
    min: -5,
    max: 150,
    restOffset: 0,
  },
  // Left leg — ball-joint hip, hinge knee. startJoint=pelvis so it branches
  // off the pelvis even though its angle reference is the spine.
  {
    name: 'L-thigh',
    endJoint: 'L-knee',
    parentName: 'spine',
    startJoint: 'pelvis',
    length: 110,
    angle: 8,
    min: -360,
    max: 360,
    restOffset: 180,
  },
  {
    name: 'L-shin',
    endJoint: 'L-foot',
    parentName: 'L-thigh',
    length: 95,
    angle: 8,
    min: -5,
    max: 130,
    restOffset: 0,
  },
  // Right leg
  {
    name: 'R-thigh',
    endJoint: 'R-knee',
    parentName: 'spine',
    startJoint: 'pelvis',
    length: 110,
    angle: -8,
    min: -360,
    max: 360,
    restOffset: 180,
  },
  {
    name: 'R-shin',
    endJoint: 'R-foot',
    parentName: 'R-thigh',
    length: 95,
    angle: -8,
    min: -130,
    max: 5,
    restOffset: 0,
  },
];

// Build joints + bones from BONE_SPEC. Forward-kinematics the rest pose so
// the figure renders sensibly on mount. Also returns `jointParent[i]` — the
// joint index that's parent to joint i in the bone tree, -1 for pelvis. Used
// by the BONES panel to decide which bones are downstream of the handle.
export function makeBody(): {
  joints: Joint[];
  bones: Bone[];
  jointParent: number[];
} {
  const joints: Joint[] = [makeJoint('pelvis', ORIGIN)];
  const jointIdxByName = new Map<string, number>([['pelvis', 0]]);
  const boneByName = new Map<string, Bone>();
  const bones: Bone[] = [];

  for (const spec of BONE_SPEC) {
    const parent = spec.parentName
      ? (boneByName.get(spec.parentName) ?? null)
      : null;
    const startName =
      spec.startJoint ?? (parent ? joints[parent.endIdx].name : 'pelvis');
    const startIdx = jointIdxByName.get(startName);
    if (startIdx === undefined) {
      throw new Error(`bone ${spec.name}: unknown startJoint "${startName}"`);
    }

    // Parent direction at construction time, for rest-pose forward kinematics.
    let parentTheta = 0;
    if (parent) {
      const sp = joints[parent.startIdx].pos.current;
      const ep = joints[parent.endIdx].pos.current;
      parentTheta = Math.atan2(ep.y - sp.y, ep.x - sp.x);
    }
    const absTheta =
      parentTheta + ((spec.angle + spec.restOffset) * Math.PI) / 180;
    const startPos = joints[startIdx].pos.current;
    const endPos: Point = {
      x: startPos.x + spec.length * Math.cos(absTheta),
      y: startPos.y + spec.length * Math.sin(absTheta),
    };

    const endIdx = joints.length;
    joints.push(makeJoint(spec.endJoint, endPos));
    jointIdxByName.set(spec.endJoint, endIdx);

    const bone: Bone = {
      name: spec.name,
      length: spec.length,
      min: spec.min,
      max: spec.max,
      restOffset: spec.restOffset,
      parent,
      startIdx,
      endIdx,
      stuck: createRefSignal(false),
    };
    boneByName.set(spec.name, bone);
    bones.push(bone);
  }

  // jointParent[i] = startIdx of the bone whose endIdx is i, or -1 for pelvis.
  const jointParent = new Array<number>(joints.length).fill(-1);
  for (const bone of bones) {
    jointParent[bone.endIdx] = bone.startIdx;
  }

  return { joints, bones, jointParent };
}

// True when the handle joint lies on the path from `boneStart` up to the
// pelvis — i.e. the bone is downstream of (hangs from) the handle. Used to
// dim "free" bones in the BONES panel.
export function isBoneDownstream(
  boneStart: number,
  handleJointIdx: number,
  jointParent: number[],
): boolean {
  let cur = boneStart;
  while (cur !== -1) {
    if (cur === handleJointIdx) return true;
    cur = jointParent[cur];
  }
  return false;
}

// One frame of physics. Mutates joint positions and bone.stuck.
//
// There is exactly one pin per frame: the handle joint, which is forced to
// the mouse position (target). Everything else floats and falls under
// gravity, constrained by bone length + angle limits.
export function step(
  joints: Joint[],
  bones: Bone[],
  handleIndex: number,
  target: Point,
): void {
  const HANDLE_OUT_IDX = handleIndex + 1; // joint pinned this frame
  const isPinned = (i: number) => i === HANDLE_OUT_IDX;

  // 1. Verlet integration for non-pinned joints.
  // In-place mutation + .notify() everywhere below — `step()` runs many
  // thousands of position updates per frame; allocating a fresh `{x, y}`
  // for every `.update()` was the dominant GC pressure.
  for (let i = 0; i < joints.length; i++) {
    if (isPinned(i)) continue;
    const j = joints[i];
    const cur = j.pos.current;
    const oldX = cur.x;
    const oldY = cur.y;
    const vx = (oldX - j.prev.x) * DAMPING;
    const vy = (oldY - j.prev.y) * DAMPING;
    // Save the pre-integration position into `prev` (copy fields — don't
    // share the reference with `pos.current`, since we're about to mutate it).
    j.prev.x = oldX;
    j.prev.y = oldY;
    cur.x = oldX + vx;
    cur.y = oldY + vy + GRAVITY;
    j.pos.notify();
  }

  // 2. Pin enforcement. The handle joint IS the mouse position — set both
  //    `pos` and `prev` so the joint carries no synthetic velocity on the
  //    frame it's released (the next frame's verlet sees zero motion).
  if (HANDLE_OUT_IDX < joints.length) {
    const j = joints[HANDLE_OUT_IDX];
    j.pos.current.x = target.x;
    j.pos.current.y = target.y;
    j.prev.x = target.x;
    j.prev.y = target.y;
    j.pos.notify();
  }

  // 3. Constraint relaxation. Each iteration runs a LENGTH pass (Verlet)
  //    then an ANGLE pass over all bones. The angle pass rotates using
  //    bone.length (rest length) — so it also satisfies length along the
  //    clamped direction. When the end joint is pinned, the angle is
  //    enforced by moving the START joint along the clamped direction
  //    (CCD-style), so the handle bone still respects its limits.
  //
  //    `clampedLast` collects bones whose angle was clamped on the FINAL
  //    iteration — i.e. the chain couldn't resolve the violation, so the
  //    bone is genuinely sitting at its limit (vs. transient overshoot
  //    that the next iteration cleaned up). Used for STUCK + CANCEL below.
  const clampedLast = new Set<Bone>();
  for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
    const isLastIter = iter === CONSTRAINT_ITERATIONS - 1;
    // 3a. Length pass.
    for (const bone of bones) {
      const aIdx = bone.startIdx;
      const bIdx = bone.endIdx;
      const aPinned = isPinned(aIdx);
      const bPinned = isPinned(bIdx);
      if (aPinned && bPinned) continue;
      const a = joints[aIdx];
      const b = joints[bIdx];
      const ax = a.pos.current.x;
      const ay = a.pos.current.y;
      const bx = b.pos.current.x;
      const by = b.pos.current.y;
      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.0001) continue;
      const err = (dist - bone.length) / dist;
      const sA = aPinned ? 0 : bPinned ? 1 : 0.5;
      const sB = aPinned ? 1 : bPinned ? 0 : 0.5;
      if (!aPinned) {
        a.pos.current.x = ax + dx * err * sA;
        a.pos.current.y = ay + dy * err * sA;
        a.pos.notify();
      }
      if (!bPinned) {
        b.pos.current.x = bx - dx * err * sB;
        b.pos.current.y = by - dy * err * sB;
        b.pos.notify();
      }
    }
    // 3b. Angle pass.
    for (const bone of bones) {
      const aIdx = bone.startIdx;
      const bIdx = bone.endIdx;
      const aPinned = isPinned(aIdx);
      const bPinned = isPinned(bIdx);
      if (aPinned && bPinned) continue;
      const a = joints[aIdx];
      const b = joints[bIdx];
      const ax = a.pos.current.x;
      const ay = a.pos.current.y;
      const bx = b.pos.current.x;
      const by = b.pos.current.y;
      const parentTheta = bone.parent
        ? Math.atan2(
            joints[bone.parent.endIdx].pos.current.y -
              joints[bone.parent.startIdx].pos.current.y,
            joints[bone.parent.endIdx].pos.current.x -
              joints[bone.parent.startIdx].pos.current.x,
          )
        : 0;
      const ownTheta = Math.atan2(by - ay, bx - ax);
      let localDeg =
        ((ownTheta - parentTheta) * 180) / Math.PI - bone.restOffset;
      while (localDeg > 180) localDeg -= 360;
      while (localDeg < -180) localDeg += 360;
      if (localDeg >= bone.min && localDeg <= bone.max) continue;
      if (isLastIter) clampedLast.add(bone);
      const clampedDeg = Math.max(bone.min, Math.min(bone.max, localDeg));
      const absTheta =
        parentTheta + ((clampedDeg + bone.restOffset) * Math.PI) / 180;
      const cos = Math.cos(absTheta);
      const sin = Math.sin(absTheta);
      if (!aPinned && !bPinned) {
        // Both free — rotate the bone around its midpoint so the correction
        // splits between endpoints (symmetric, like the length pass).
        // Asymmetric "move only b" was biasing the solver and leaving
        // residual stretch in pure ragdoll mode.
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const half = bone.length / 2;
        a.pos.current.x = mx - cos * half;
        a.pos.current.y = my - sin * half;
        a.pos.notify();
        b.pos.current.x = mx + cos * half;
        b.pos.current.y = my + sin * half;
        b.pos.notify();
      } else if (!bPinned) {
        // a pinned, b free — place b at rest-length along clamped dir.
        b.pos.current.x = ax + cos * bone.length;
        b.pos.current.y = ay + sin * bone.length;
        b.pos.notify();
      } else {
        // b pinned, a free — back-project a from the pinned end.
        a.pos.current.x = bx - cos * bone.length;
        a.pos.current.y = by - sin * bone.length;
        a.pos.notify();
      }
    }
  }

  // 4. Update `bone.stuck` and CANCEL the verlet rebound for genuinely
  //    stuck bones. A bone is "stuck" only if it needed clamping on the
  //    FINAL iteration — i.e. the chain couldn't resolve the violation by
  //    moving neighbors. Closeness to a limit (without an active clamp)
  //    does NOT count: that's a bone hanging naturally near its boundary,
  //    and damping it there would make gravity feel like it slows down at
  //    "certain angles".
  //
  //    Without CANCEL, the angle clamp keeps fighting next-frame verlet
  //    inertia and the limit becomes a high-frequency oscillator. Light
  //    damping (20%) is enough to kill the rebound's high-frequency tail
  //    without making gravity feel "sticky" at limits.
  //    See [[feedback_cancel_vs_clamp_iterative_solvers]].
  const LIMIT_DAMP = 0.2;
  for (const bone of bones) {
    const stuck = clampedLast.has(bone);
    bone.stuck.update(stuck);
    if (!stuck) continue;
    const a = joints[bone.startIdx];
    const b = joints[bone.endIdx];
    const aCur = a.pos.current;
    const bCur = b.pos.current;
    a.prev.x = aCur.x - (aCur.x - a.prev.x) * (1 - LIMIT_DAMP);
    a.prev.y = aCur.y - (aCur.y - a.prev.y) * (1 - LIMIT_DAMP);
    b.prev.x = bCur.x - (bCur.x - b.prev.x) * (1 - LIMIT_DAMP);
    b.prev.y = bCur.y - (bCur.y - b.prev.y) * (1 - LIMIT_DAMP);
  }
}
