// Mode metadata + dispatch component, shared between the manual demo
// (graph/svg.tsx) and the autobench (graph/automated.tsx).
// Adding a new mode means: define it here, update Mode in ./harness,
// and add the Graph component to the matching bench/<lib>.tsx file.

import React from 'react';
import { JOTAI_C, MOBX_C, REACT_C, SIG_C, ZUS_C } from './shared';
import { type Mode, type Renderer } from './harness';
import { SigGraph, SigRenderGraph } from './refsignal';
import { JGraph, JImpGraph } from './jotai';
import { ZGraph, ZImpGraph } from './zustand';
import { MGraph, MAutoGraph } from './mobx';
import { RGraph } from './react-memo';

export const MODE_META: Record<
  Mode,
  { color: string; label: string; hint: string }
> = {
  signal: {
    color: SIG_C,
    label: 'RefSignal',
    hint: 'Blessed path · useRefSignalEffect + setAttribute · zero React renders',
  },
  'signal-render': {
    color: SIG_C,
    label: 'RefSignal (render)',
    hint: 'Opt-in React path · useRefSignalRender · component re-renders per update',
  },
  jotai: {
    color: JOTAI_C,
    label: 'Jotai',
    hint: 'Blessed path · useAtom · per-atom React re-render',
  },
  'jotai-imperative': {
    color: JOTAI_C,
    label: 'Jotai (imperative)',
    hint: 'Escape hatch · store.sub + ref + setAttribute · zero React renders',
  },
  zustand: {
    color: ZUS_C,
    label: 'Zustand',
    hint: 'Blessed path · useStore(selector) · all subscribers walk on every setState',
  },
  'zustand-imperative': {
    color: ZUS_C,
    label: 'Zustand (imperative)',
    hint: 'Escape hatch · subscribeWithSelector + ref + setAttribute · zero React renders',
  },
  mobx: {
    color: MOBX_C,
    label: 'MobX',
    hint: 'Blessed path · observable + observer · auto-tracked React re-renders',
  },
  'mobx-autorun': {
    color: MOBX_C,
    label: 'MobX (autorun)',
    hint: 'Escape hatch · autorun + ref + setAttribute · zero React renders',
  },
  react: {
    color: REACT_C,
    label: 'React + memo',
    hint: 'No escape hatch · useState in parent · full React re-render',
  },
};

export const MODE_ORDER = Object.keys(MODE_META) as Mode[];

// `renderer` overrides BENCH.renderer for this mount. Useful for the
// manual demos at #graph (svg) and #canvas (canvas), which want to force
// one path regardless of URL params. The autobench omits it and lets
// BENCH.renderer decide.
export function ModeGraph({
  mode,
  count,
  renderer,
}: {
  mode: Mode;
  count: number;
  renderer?: Renderer;
}) {
  switch (mode) {
    case 'signal':
      return <SigGraph count={count} renderer={renderer} />;
    case 'signal-render':
      return <SigRenderGraph count={count} renderer={renderer} />;
    case 'jotai':
      return <JGraph count={count} renderer={renderer} />;
    case 'jotai-imperative':
      return <JImpGraph count={count} renderer={renderer} />;
    case 'zustand':
      return <ZGraph count={count} renderer={renderer} />;
    case 'zustand-imperative':
      return <ZImpGraph count={count} renderer={renderer} />;
    case 'mobx':
      return <MGraph count={count} renderer={renderer} />;
    case 'mobx-autorun':
      return <MAutoGraph count={count} renderer={renderer} />;
    case 'react':
      return <RGraph count={count} renderer={renderer} />;
  }
}
