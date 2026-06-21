// Shared body for the two manual draggable-graph demos. svg.tsx and canvas.tsx
// are thin wrappers over this — the only differences are the renderer passed to
// ModeGraph, the "CANVAS" toolbar tag, and the scroll behaviour of the stage.
//
// All 9 modes (refsignal & each competitor in both blessed and escape-hatch
// flavors) live in ../bench/{refsignal,jotai,zustand,mobx,react-memo}.tsx; this
// file is just the toolbar, slider, and the shared mode dispatcher.
//
// On the manual routes BENCH.durationSec stays 0 (no `?autodrag` query param),
// so each Graph's AutoDriver clause stays disabled — you get pointer-drag
// interaction without the programmatic sweep.

import { useMemo, useState } from 'react';
import { type Mode } from '../bench/harness';
import { MODE_META, MODE_ORDER, ModeGraph } from '../bench/modes';
import { countEdges, resetRenders } from '../bench/shared';
import { Stats } from '../bench/stats';
import {
  btnStyle,
  canvasContainer,
  countReadout,
  hintStyle,
  nodesLabel,
  pageStyle,
  rightGroup,
  svgContainer,
  toolbarStyle,
} from '../styles/graph.styles';

export function ManualGraph({
  renderer,
  title,
}: {
  // Omitted on the svg route so BENCH.renderer decides (matches the original
  // #graph behaviour); forced to 'canvas' on the canvas route.
  renderer?: 'svg' | 'canvas';
  title?: string;
}) {
  const [mode, setMode] = useState<Mode>('signal');
  const [count, setCount] = useState(100);
  const edges = useMemo(() => countEdges(count), [count]);
  const meta = MODE_META[mode];

  const switchMode = (m: Mode) => {
    resetRenders();
    setMode(m);
  };

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        {title && <b style={{ fontSize: 13, marginRight: 4 }}>{title}</b>}
        {MODE_ORDER.map((m) => (
          <button
            key={m}
            onClick={() => {
              switchMode(m);
            }}
            style={btnStyle(mode === m, MODE_META[m].color)}
          >
            {MODE_META[m].label}
          </button>
        ))}

        <label style={nodesLabel}>
          Nodes
          <input
            type="range"
            min={9}
            max={10000}
            value={count}
            onChange={(e) => {
              resetRenders();
              setCount(+e.target.value);
            }}
          />
        </label>

        <span style={countReadout}>
          {count}n + {edges}e = <b>{count + edges}</b>
        </span>

        <span style={rightGroup}>
          <Stats mode={mode} />
        </span>
      </div>

      <div style={hintStyle}>{meta.hint}</div>

      <div style={renderer === 'canvas' ? canvasContainer : svgContainer}>
        <ModeGraph
          key={`${mode}-${count}`}
          mode={mode}
          count={count}
          renderer={renderer}
        />
      </div>
    </div>
  );
}
