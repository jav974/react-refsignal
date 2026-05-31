import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountDevTools } from '../src/devtools';
import GraphBenchmark from './graph-benchmark';
import GraphBenchmarkAutomated from './graph-benchmark-automated';
import GraphBenchmarkCanvas from './graph-benchmark-canvas';
import ThemeDemo from './theme-demo';
import GameOfLife from './game-of-life';
import Agents from './agents';
import Heartbeat from './heartbeat';
import Skeleton from './skeleton';

// No StrictMode — its dev-mode double renders skew benchmark numbers.

type Route =
  | 'graph'
  | 'canvas'
  | 'autobench'
  | 'theme'
  | 'gol'
  | 'agents'
  | 'heart'
  | 'skeleton';

function parseRoute(): Route {
  if (window.location.hash === '#canvas') return 'canvas';
  if (window.location.hash === '#autobench') return 'autobench';
  if (window.location.hash === '#theme') return 'theme';
  if (window.location.hash === '#gol') return 'gol';
  if (window.location.hash === '#agents') return 'agents';
  if (window.location.hash === '#heart') return 'heart';
  if (window.location.hash === '#skeleton') return 'skeleton';
  return 'graph';
}

function Demos() {
  const [route, setRoute] = useState<Route>(parseRoute());

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  return (
    <>
      <nav
        style={{
          position: 'fixed',
          // Sit above the devtools dock when present; degrade to plain 12px
          // bottom when the var isn't set (overlay unmounted or prod build).
          bottom: 'calc(var(--refsignal-devtools-height, 0px) + 12px)',
          right: 12,
          zIndex: 100,
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          borderRadius: 6,
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
        }}
      >
        <a href="#graph" style={navBtn(route === 'graph')}>
          Graph (SVG)
        </a>
        <a href="#canvas" style={navBtn(route === 'canvas')}>
          Graph (Canvas)
        </a>
        {/*
          No #autobench link on purpose. The automated benchmark must run with
          devtools unmounted (see mountDevTools guard below) — but that guard
          only fires on a fresh page load. Reaching #autobench via a navlink is
          a client-side hashchange that leaves devtools mounted, biasing the
          RefSignal numbers. The headless runner (benchmark-runner/run.mjs)
          navigates to a fresh /?...#autobench URL, so it's unaffected.
        */}
        <a href="#theme" style={navBtn(route === 'theme')}>
          Theme sync (persist + broadcast)
        </a>
        <a href="#gol" style={navBtn(route === 'gol')}>
          Game of Life
        </a>
        <a href="#agents" style={navBtn(route === 'agents')}>
          Agents
        </a>
        <a href="#heart" style={navBtn(route === 'heart')}>
          Heartbeat (pulse)
        </a>
        <a href="#skeleton" style={navBtn(route === 'skeleton')}>
          Ragdoll (pulse)
        </a>
      </nav>
      {route === 'graph' && <GraphBenchmark />}
      {route === 'canvas' && <GraphBenchmarkCanvas />}
      {route === 'autobench' && <GraphBenchmarkAutomated />}
      {route === 'theme' && <ThemeDemo />}
      {route === 'gol' && <GameOfLife />}
      {route === 'agents' && <Agents />}
      {route === 'heart' && <Heartbeat />}
      {route === 'skeleton' && <Skeleton />}
    </>
  );
}

function navBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 4,
    background: active ? '#4a9eff' : 'transparent',
    color: active ? '#fff' : '#9ca3af',
    textDecoration: 'none',
    fontWeight: 600,
  };
}

// Skip devtools on the automated benchmark route — devtools subscribes to
// every refsignal event, which makes the RefSignal mode pay a cost the
// other libs don't, biasing measurements.
if (window.location.hash !== '#autobench') {
  mountDevTools();
}
createRoot(document.getElementById('root')!).render(<Demos />);
