// Automated version of the graph benchmark — entry point.
//
// Per-implementation code lives in ./bench/{refsignal,jotai,zustand,mobx,
// react-memo}.tsx so each library's pattern can be read in isolation. This
// file just wires the dispatcher and renders the toolbar + MatrixRunner UI.
//
// URL params (parsed in ./bench/harness.tsx):
//   ?mode=signal|signal-render|jotai|jotai-imperative|zustand|
//        zustand-imperative|mobx|mobx-autorun|react
//   ?nodes=N
//   ?autodrag=N          seconds of measurement (0 = manual, default 0)
//   ?warmup=N            ms to wait after mount before measuring
//   ?rate=N              drives per requestAnimationFrame (raf mode only)
//   ?escape=0|1          flushSync each drive (default 1)
//   ?driveMode=raf|interval
//   ?intervalMs=N        interval-mode period (default 4 ms)
//   ?renderer=svg|canvas
//   ?matrix=1            run {modes × matrixNodes} in-page, dump JSON
//   ?modes=a,b,c         (matrix-mode only) restrict modes
//   ?matrixNodes=200,500,1000,2000  (matrix-mode only) restrict node counts

import { useEffect, useMemo, useState } from 'react';
import {
  AUTOMATED,
  BENCH,
  type BenchResult,
  type Mode,
  useBenchDone,
} from './bench/harness';
import { MODE_META, MODE_ORDER, ModeGraph } from './bench/modes';
import { countEdges, resetRenders } from './bench/shared';
import { Stats } from './bench/stats';
import {
  btnStyle,
  countReadout,
  hintStyle,
  nodesLabel,
  pageStyle,
  rightGroup,
  svgContainer,
  tdStyle,
  toolbarStyle,
} from './styles/graph.styles';

// ---------------------------------------------------------------
// Matrix runner — iterates {modes × matrixNodes} in one page so the user
// can run the full benchmark in their native browser without Playwright.
// ---------------------------------------------------------------

type MatrixCell = { mode: Mode; nodes: number };

function buildMatrix(): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const n of BENCH.matrixNodes) {
    for (const m of BENCH.matrixModes) {
      cells.push({ mode: m, nodes: n });
    }
  }
  return cells;
}

function MatrixRunner() {
  const cells = useMemo(() => buildMatrix(), []);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<BenchResult[]>([]);
  const done = index >= cells.length;

  // Reset window.__bench__ whenever a new cell starts; poll for ready.
  useEffect(() => {
    if (done) return;
    window.__bench__ = { ready: false, phase: 'pending' };
    const id = window.setInterval(() => {
      const b = window.__bench__;
      if (b?.ready) {
        window.clearInterval(id);
        setResults((rs) => [...rs, b]);
        setIndex((i) => i + 1);
      }
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [index, done]);

  if (done) {
    return <MatrixResults results={results} />;
  }

  const cell = cells[index];
  const progress = `${index + 1}/${cells.length}`;
  const eta = Math.max(
    0,
    (cells.length - index) * (BENCH.warmupMs / 1000 + BENCH.durationSec + 2),
  );

  return (
    <div style={pageStyle}>
      <div
        style={{
          padding: '8px 14px',
          background: '#16213e',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
          fontFamily: 'monospace',
          flexWrap: 'wrap',
        }}
      >
        <b>MATRIX</b>
        <span>
          {progress} · mode=
          <b style={{ color: MODE_META[cell.mode].color }}>{cell.mode}</b> ·
          nodes={cell.nodes}
        </span>
        <span style={{ opacity: 0.6 }}>
          {BENCH.driveMode === 'interval'
            ? `interval=${BENCH.intervalMs}ms`
            : `rate=${BENCH.rate}/rAF`}{' '}
          · flushSync={BENCH.escapeBatching ? 'on' : 'off'}
        </span>
        <span style={{ opacity: 0.5 }}>
          ~{Math.ceil(eta)}s remaining · keep this tab focused
        </span>
        <span style={rightGroup} key={`stats-${index}`}>
          <Stats mode={cell.mode} />
        </span>
      </div>
      <div style={svgContainer}>
        <ModeGraph key={`m${index}`} mode={cell.mode} count={cell.nodes} />
      </div>
    </div>
  );
}

function MatrixResults({ results }: { results: BenchResult[] }) {
  const payload = useMemo(() => {
    const env = {
      autodragSec: BENCH.durationSec,
      warmupMs: BENCH.warmupMs,
      rate: BENCH.rate,
      escapeBatching: BENCH.escapeBatching,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      generatedAt: new Date().toISOString(),
    };
    return JSON.stringify({ env, results }, null, 2);
  }, [results]);

  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  const download = () => {
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        background: '#1a1a2e',
        color: '#fff',
        minHeight: '100vh',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ margin: '0 0 12px', fontSize: 20 }}>
        Matrix complete — {results.length} cells
      </h1>
      <div style={{ marginBottom: 16, opacity: 0.7, fontSize: 13 }}>
        UA: {navigator.userAgent}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => {
            void copy();
          }}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: 6,
            background: copied ? '#16a34a' : '#4a9eff',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
        <button
          onClick={download}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: 6,
            background: '#334155',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Download .json
        </button>
      </div>
      <table
        style={{
          borderCollapse: 'collapse',
          fontFamily: 'monospace',
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        <thead>
          <tr style={{ background: '#16213e' }}>
            <th style={tdStyle}>#</th>
            <th style={tdStyle}>Mode</th>
            <th style={tdStyle}>Nodes</th>
            <th style={tdStyle}>fpsMean</th>
            <th style={tdStyle}>fpsMin</th>
            <th style={tdStyle}>fpsMax</th>
            <th style={tdStyle}>rpsMean</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td style={tdStyle}>{i + 1}</td>
              <td
                style={{ ...tdStyle, color: MODE_META[r.mode as Mode].color }}
              >
                {r.mode}
              </td>
              <td style={tdStyle}>{r.nodes}</td>
              <td style={tdStyle}>{r.fpsMean.toFixed(2)}</td>
              <td style={tdStyle}>{r.fpsMin}</td>
              <td style={tdStyle}>{r.fpsMax}</td>
              <td style={tdStyle}>{r.rpsMean.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details style={{ maxWidth: 800 }}>
        <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
          Raw JSON
        </summary>
        <pre
          style={{
            background: '#0d1117',
            padding: 12,
            borderRadius: 6,
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 400,
          }}
        >
          {payload}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------
// Default export
// ---------------------------------------------------------------

export default function GraphBenchmarkAutomated() {
  return BENCH.matrix ? <MatrixRunner /> : <SingleRunUI />;
}

function SingleRunUI() {
  const [mode, setMode] = useState<Mode>(BENCH.mode);
  const [count, setCount] = useState(BENCH.nodes);
  const edges = useMemo(() => countEdges(count), [count]);
  const meta = MODE_META[mode];
  const benchDone = useBenchDone();

  const switchMode = (m: Mode) => {
    if (AUTOMATED) return;
    resetRenders();
    setMode(m);
  };

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        {MODE_ORDER.map((m) => (
          <button
            key={m}
            onClick={() => {
              switchMode(m);
            }}
            disabled={AUTOMATED}
            style={btnStyle(mode === m, MODE_META[m].color)}
          >
            {MODE_META[m].label}
          </button>
        ))}

        <label style={{ ...nodesLabel, opacity: AUTOMATED ? 0.4 : 1 }}>
          Nodes
          <input
            type="range"
            min={9}
            max={10000}
            value={count}
            disabled={AUTOMATED}
            onChange={(e) => {
              resetRenders();
              setCount(+e.target.value);
            }}
          />
        </label>

        <span style={countReadout}>
          {count}n + {edges}e = <b>{count + edges}</b>
        </span>

        {AUTOMATED && (
          <span
            data-bench-status={benchDone ? 'done' : 'running'}
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              padding: '2px 8px',
              borderRadius: 4,
              background: benchDone ? '#16a34a' : '#b45309',
            }}
          >
            {benchDone
              ? 'BENCH DONE'
              : `BENCH RUNNING (${BENCH.durationSec}s · ${
                  BENCH.driveMode === 'interval'
                    ? `interval=${BENCH.intervalMs}ms`
                    : `rate=${BENCH.rate}/rAF`
                }${BENCH.escapeBatching ? ' · flushSync' : ''})`}
          </span>
        )}

        <span style={rightGroup}>
          <Stats mode={mode} />
        </span>
      </div>

      <div style={hintStyle}>{meta.hint}</div>

      <div style={svgContainer}>
        <ModeGraph key={`${mode}-${count}`} mode={mode} count={count} />
      </div>
    </div>
  );
}
