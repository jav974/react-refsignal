import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountDevTools } from '../src/devtools';
import { DemoNav } from './common/components/DemoNav';
import { DEFAULT_HASH, DEMOS } from './demos/registry';

// No StrictMode — its dev-mode double renders skew benchmark numbers.

function currentHash(): string {
  return window.location.hash.replace(/^#/, '') || DEFAULT_HASH;
}

function Demos() {
  const [hash, setHash] = useState(currentHash());

  useEffect(() => {
    const onHash = () => {
      setHash(currentHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const entry =
    DEMOS.find((d) => d.hash === hash) ??
    DEMOS.find((d) => d.hash === DEFAULT_HASH)!;
  const Active = entry.component;
  const navItems = DEMOS.filter((d) => !d.hidden);

  return (
    <>
      <DemoNav items={navItems} active={entry.hash} />
      <Active />
    </>
  );
}

// Skip devtools on the automated benchmark route — devtools subscribes to
// every refsignal event, which makes the RefSignal mode pay a cost the
// other libs don't, biasing measurements.
if (window.location.hash !== '#autobench') {
  mountDevTools();
}
createRoot(document.getElementById('root')!).render(<Demos />);
