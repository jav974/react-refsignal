import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GraphBenchmark from './graph-benchmark';
import ThemeDemo from './theme-demo';

// StrictMode removed for clean benchmark numbers (it double-renders in dev).

type Route = 'graph' | 'theme';

function parseRoute(): Route {
  return window.location.hash === '#theme' ? 'theme' : 'graph';
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
          bottom: 12,
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
          Graph benchmark
        </a>
        <a href="#theme" style={navBtn(route === 'theme')}>
          Theme sync (persist + broadcast)
        </a>
      </nav>
      {route === 'graph' ? <GraphBenchmark /> : <ThemeDemo />}
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

createRoot(document.getElementById('root')!).render(<Demos />);
