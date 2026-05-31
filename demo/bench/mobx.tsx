// mobx — two modes:
//   4.  mobx          (blessed): observable({ x, y }) + observer(Component).
//                                 The observer HOC auto-tracks any
//                                 observables read during render and
//                                 re-renders the component when they change.
//                                 No deps array.
//   4b. mobx-autorun  (escape):  autorun(() => setAttribute(...)) inside
//                                 useEffect. Same auto-tracking — every
//                                 observable accessed inside the autorun
//                                 callback becomes a dep. No React renders.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { autorun, observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { canvasStyle, useCanvasScene } from '../canvas-helpers';
import {
  MOBX_C,
  bumpRender,
  dragPos,
  endDrag,
  generateGraph,
  nodeInner,
  startDrag,
  svgStyle,
  useDragRefs,
  type Edge,
  type Pos,
} from './shared';
import { AUTOMATED, BENCH, runAutoBench, type Renderer } from './harness';

type MNodeData = { x: number; y: number };

// ---------------------------------------------------------------
// 4. MobX blessed path — observable + observer HOC
// ---------------------------------------------------------------

const MNode = observer(function MNode({
  node,
  id,
}: {
  node: MNodeData;
  id: number;
}) {
  bumpRender();
  const drag = useDragRefs();
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, { x: node.x, y: node.y }, drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (!p) return;
        runInAction(() => {
          node.x = p.x;
          node.y = p.y;
        });
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, MOBX_C)}
    </g>
  );
});

const MEdge = observer(function MEdge({
  from,
  to,
}: {
  from: MNodeData;
  to: MNodeData;
}) {
  bumpRender();
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke="rgba(255,255,255,0.18)"
      strokeWidth={1}
    />
  );
});

function MAutoDriver({
  node,
  initial,
  count,
}: {
  node: MNodeData;
  initial: Pos;
  count: number;
}) {
  useEffect(() => {
    return runAutoBench({
      mode: 'mobx',
      nodes: count,
      drive: (p) => {
        runInAction(() => {
          node.x = p.x;
          node.y = p.y;
        });
      },
      initial,
    });
  }, [node, initial, count]);
  return null;
}

function MCanvasView({
  observableNodes,
  edges,
  w,
  h,
}: {
  observableNodes: MNodeData[];
  edges: Edge[];
  w: number;
  h: number;
}) {
  bumpRender();
  const positionsRef = useRef(observableNodes.map((n) => ({ x: n.x, y: n.y })));
  const dirtyRef = useRef(true);
  const readPositions = useCallback(() => {
    for (let i = 0; i < observableNodes.length; i++) {
      positionsRef.current[i].x = observableNodes[i].x;
      positionsRef.current[i].y = observableNodes[i].y;
    }
    return positionsRef.current;
  }, [observableNodes]);
  // One autorun tracks every node's x/y; on any change, mark dirty.
  useEffect(() => {
    return autorun(() => {
      for (const n of observableNodes) {
        void n.x;
        void n.y;
      }
      dirtyRef.current = true;
    });
  }, [observableNodes]);
  const { canvasRef } = useCanvasScene({
    w,
    h,
    edges,
    accent: MOBX_C,
    readPositions,
    dirtyRef,
  });
  return <canvas ref={canvasRef} style={canvasStyle} />;
}

export function MGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const observableNodes = useMemo<MNodeData[]>(
    () => nodes.map((n) => observable({ x: n.x, y: n.y })),
    [nodes],
  );
  const r = renderer ?? BENCH.renderer;
  return (
    <>
      {r === 'canvas' ? (
        <MCanvasView
          observableNodes={observableNodes}
          edges={edges}
          w={w}
          h={h}
        />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <MEdge key={i} from={observableNodes[a]} to={observableNodes[b]} />
          ))}
          {observableNodes.map((n, i) => (
            <MNode key={i} node={n} id={i} />
          ))}
        </svg>
      )}
      {AUTOMATED && (
        <MAutoDriver
          node={observableNodes[0]}
          initial={nodes[0]}
          count={count}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------
// 4b. MobX autorun — escape hatch
// ---------------------------------------------------------------
// `autorun(fn)` re-runs `fn` whenever any observable it accesses
// changes. Pointed at setAttribute, this bypasses React entirely.

function MAutoNode({ node, id }: { node: MNodeData; id: number }) {
  bumpRender();
  const gRef = useRef<SVGGElement>(null);
  const drag = useDragRefs();
  useEffect(() => {
    return autorun(() => {
      gRef.current?.setAttribute('transform', `translate(${node.x},${node.y})`);
    });
  }, [node]);
  return (
    <g
      ref={gRef}
      transform={`translate(${node.x},${node.y})`}
      cursor="grab"
      onPointerDown={(e) => {
        startDrag(e, { x: node.x, y: node.y }, drag);
      }}
      onPointerMove={(e) => {
        const p = dragPos(e, drag);
        if (!p) return;
        runInAction(() => {
          node.x = p.x;
          node.y = p.y;
        });
      }}
      onPointerUp={(e) => {
        endDrag(e, drag);
      }}
    >
      {nodeInner(id, MOBX_C)}
    </g>
  );
}

function MAutoEdge({ from, to }: { from: MNodeData; to: MNodeData }) {
  bumpRender();
  const ref = useRef<SVGLineElement>(null);
  useEffect(() => {
    return autorun(() => {
      const el = ref.current;
      if (!el) return;
      el.setAttribute('x1', String(from.x));
      el.setAttribute('y1', String(from.y));
      el.setAttribute('x2', String(to.x));
      el.setAttribute('y2', String(to.y));
    });
  }, [from, to]);
  return (
    <line
      ref={ref}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke="rgba(255,255,255,0.18)"
      strokeWidth={1}
    />
  );
}

function MAutoAutoDriver({
  node,
  initial,
  count,
}: {
  node: MNodeData;
  initial: Pos;
  count: number;
}) {
  useEffect(() => {
    return runAutoBench({
      mode: 'mobx-autorun',
      nodes: count,
      drive: (p) => {
        runInAction(() => {
          node.x = p.x;
          node.y = p.y;
        });
      },
      initial,
    });
  }, [node, initial, count]);
  return null;
}

export function MAutoGraph({
  count,
  renderer,
}: {
  count: number;
  renderer?: Renderer;
}) {
  const { nodes, edges, w, h } = useMemo(() => generateGraph(count), [count]);
  const observableNodes = useMemo<MNodeData[]>(
    () => nodes.map((n) => observable({ x: n.x, y: n.y })),
    [nodes],
  );
  const r = renderer ?? BENCH.renderer;
  return (
    <>
      {r === 'canvas' ? (
        <MCanvasView
          observableNodes={observableNodes}
          edges={edges}
          w={w}
          h={h}
        />
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} style={svgStyle}>
          {edges.map(([a, b], i) => (
            <MAutoEdge
              key={i}
              from={observableNodes[a]}
              to={observableNodes[b]}
            />
          ))}
          {observableNodes.map((n, i) => (
            <MAutoNode key={i} node={n} id={i} />
          ))}
        </svg>
      )}
      {AUTOMATED && (
        <MAutoAutoDriver
          node={observableNodes[0]}
          initial={nodes[0]}
          count={count}
        />
      )}
    </>
  );
}
