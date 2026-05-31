// Manual canvas demo — same 9 modes as graph-benchmark.tsx but rendered
// through a single <canvas> (per mode) instead of an SVG element tree.
//
// Each Graph component in ./bench/<lib>.tsx has both an SVG branch and a
// canvas branch; this file just forces renderer="canvas" via ModeGraph
// regardless of URL params.
//
// On this `#canvas` route BENCH.durationSec stays 0, so the AutoDriver
// inside each Graph stays disabled and you interact with the canvas via
// pointer drag.

import React, { useMemo, useState } from 'react';
import { countEdges, resetRenders } from './bench/shared';
import { type Mode } from './bench/harness';
import { Stats } from './bench/stats';
import { MODE_META, MODE_ORDER, ModeGraph } from './bench/modes';

function btnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '5px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
    background: active ? color : '#333',
    color: '#fff',
    opacity: active ? 1 : 0.6,
    transition: 'opacity 0.15s',
  };
}

export default function GraphBenchmarkCanvas() {
  const [mode, setMode] = useState<Mode>('signal');
  const [count, setCount] = useState(100);
  const edges = useMemo(() => countEdges(count), [count]);
  const meta = MODE_META[mode];

  const switchMode = (m: Mode) => {
    resetRenders();
    setMode(m);
  };

  return (
    <div
      style={{
        background: '#1a1a2e',
        color: '#fff',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          background: '#16213e',
          flexWrap: 'wrap',
        }}
      >
        <b style={{ fontSize: 13, marginRight: 4 }}>CANVAS</b>
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

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 8,
            fontSize: 12,
          }}
        >
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

        <span style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>
          {count}n + {edges}e = <b>{count + edges}</b>
        </span>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Stats mode={mode} />
        </span>
      </div>

      {/* hint */}
      <div
        style={{
          padding: '3px 14px',
          fontSize: 11,
          opacity: 0.4,
          background: '#16213e',
          borderTop: '1px solid #1a1a2e',
        }}
      >
        {meta.hint}
      </div>

      {/* canvas */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 8,
          background: '#1a1a2e',
        }}
      >
        <ModeGraph
          key={`${mode}-${count}`}
          mode={mode}
          count={count}
          renderer="canvas"
        />
      </div>
    </div>
  );
}
