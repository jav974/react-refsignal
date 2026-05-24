import { useMemo, useState } from 'react';
import { devtools, type CascadeEdge } from '../../adapter';
import * as s from '../styles';
import { useDevtoolsRender } from '../useDevtoolsRender';

interface LaidOutNode {
  id: string;
  level: number;
  indexInLevel: number;
  x: number;
  y: number;
}

const NODE_W = 110;
const NODE_H = 26;
const COL_GAP = 60;
const ROW_GAP = 16;
const PAD = 16;

const assignLevels = (
  nodes: string[],
  edges: CascadeEdge[],
): Map<string, number> => {
  const incoming = new Map<string, Set<string>>();
  for (const id of nodes) incoming.set(id, new Set());
  for (const e of edges) {
    if (incoming.has(e.to) && incoming.has(e.from) && e.from !== e.to) {
      incoming.get(e.to)?.add(e.from);
    }
  }
  // Kahn-ish topo: nodes with no incoming go to level 0; iteratively peel.
  // Back-edges (cycles) are ignored — a node still pending after maxPasses
  // gets placed at the deepest current level + 1.
  const level = new Map<string, number>();
  const remaining = new Set(nodes);
  let pass = 0;
  while (remaining.size > 0 && pass < nodes.length + 1) {
    const ready: string[] = [];
    for (const id of remaining) {
      const ins = incoming.get(id);
      if (!ins) continue;
      let max = -1;
      let allAssigned = true;
      for (const dep of ins) {
        if (!level.has(dep)) {
          allAssigned = false;
          break;
        }
        const l = level.get(dep);
        if (l !== undefined && l > max) max = l;
      }
      if (allAssigned) {
        ready.push(id);
        level.set(id, max + 1);
      }
    }
    if (ready.length === 0) {
      // Cycle — promote one arbitrary node to break the deadlock.
      const id = remaining.values().next().value;
      if (id !== undefined) {
        level.set(id, Math.max(-1, ...Array.from(level.values())) + 1);
        remaining.delete(id);
      }
    } else {
      for (const id of ready) remaining.delete(id);
    }
    pass++;
  }
  for (const id of nodes) {
    if (!level.has(id)) level.set(id, 0);
  }
  return level;
};

const layout = (
  nodes: string[],
  edges: CascadeEdge[],
): { laid: LaidOutNode[]; width: number; height: number } => {
  if (nodes.length === 0) return { laid: [], width: 0, height: 0 };
  const levels = assignLevels(nodes, edges);
  const byLevel = new Map<number, string[]>();
  for (const id of nodes) {
    const l = levels.get(id) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)?.push(id);
  }
  for (const arr of byLevel.values()) arr.sort();
  const maxLevel = Math.max(...byLevel.keys());
  const maxPerLevel = Math.max(
    ...Array.from(byLevel.values(), (v) => v.length),
  );
  const laid: LaidOutNode[] = [];
  for (const [l, ids] of byLevel) {
    ids.forEach((id, i) => {
      laid.push({
        id,
        level: l,
        indexInLevel: i,
        x: PAD + l * (NODE_W + COL_GAP),
        y: PAD + i * (NODE_H + ROW_GAP),
      });
    });
  }
  const width = PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * COL_GAP;
  const height = PAD * 2 + maxPerLevel * NODE_H + (maxPerLevel - 1) * ROW_GAP;
  return { laid, width, height };
};

export function CascadePanel() {
  useDevtoolsRender();
  const [hoveredOrSelected, setHovered] = useState<string | null>(null);

  const allSignals = devtools.getAllSignals();
  const edges = devtools.getCascadeEdges();
  const nodeIds = allSignals.map((s2) => s2.id);

  const { laid, width, height } = useMemo(
    () => layout(nodeIds, edges),
    [nodeIds, edges],
  );

  if (allSignals.length === 0) {
    return <div style={s.empty}>No signals to graph yet.</div>;
  }
  if (edges.length === 0) {
    return (
      <div style={s.empty}>
        No cascade edges recorded yet.{' '}
        <span style={{ color: s.colors.textMuted }}>
          Trigger a <code>watch()</code> or computed signal that writes another
          signal, then return here.
        </span>
      </div>
    );
  }

  const byId = new Map(laid.map((n) => [n.id, n]));
  const focused = hoveredOrSelected;
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  if (focused) {
    for (const e of edges) {
      if (e.to === focused) upstream.add(e.from);
      if (e.from === focused) downstream.add(e.to);
    }
  }
  const isHot = (e: CascadeEdge): boolean =>
    !!focused && (e.from === focused || e.to === focused);

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ color: s.colors.textMuted, fontSize: 11, marginBottom: 6 }}>
        {allSignals.length} signal{allSignals.length === 1 ? '' : 's'},{' '}
        {edges.length} cascade edge{edges.length === 1 ? '' : 's'} — hover a
        node to highlight its in/out edges.
      </div>
      <svg
        width={Math.max(width, 400)}
        height={Math.max(height, 100)}
        style={{ display: 'block' }}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={s.colors.borderLight} />
          </marker>
          <marker
            id="arrow-hot"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={s.colors.accent} />
          </marker>
        </defs>
        {edges.map((e) => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const dimmed = focused && !isHot(e);
          const hot = isHot(e);
          const strokeColor = hot ? s.colors.accent : s.colors.borderLight;
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={strokeColor}
              strokeOpacity={dimmed ? 0.18 : 0.9}
              strokeWidth={hot ? 2 : 1}
              markerEnd={`url(#${hot ? 'arrow-hot' : 'arrow'})`}
            />
          );
        })}
        {laid.map((n) => {
          const isFocused = n.id === focused;
          const isUp = upstream.has(n.id);
          const isDown = downstream.has(n.id);
          const fill = isFocused
            ? s.colors.accent
            : isUp
              ? s.colors.success
              : isDown
                ? s.colors.warn
                : s.colors.bgAlt;
          const stroke = isFocused ? s.colors.accent : s.colors.borderLight;
          const textColor =
            isFocused || isUp || isDown ? s.colors.bg : s.colors.text;
          return (
            <g
              key={n.id}
              transform={`translate(${String(n.x)},${String(n.y)})`}
              onMouseEnter={() => {
                setHovered(n.id);
              }}
              onMouseLeave={() => {
                setHovered(null);
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
              />
              <text
                x={NODE_W / 2}
                y={NODE_H / 2 + 4}
                textAnchor="middle"
                fill={textColor}
                fontSize={11}
                fontFamily="inherit"
              >
                {n.id.length > 14 ? n.id.slice(0, 13) + '…' : n.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
