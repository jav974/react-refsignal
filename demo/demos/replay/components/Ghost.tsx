// A single ghost: its own replay of the shared pointer, positioned in a
// frame-coalesced effect. The body is the exact code you'd write against the
// live pointer — only the signal it points at differs.

import { useRef } from 'react';
import {
  useReplayRefSignal,
  useRefSignalEffect,
  type ReadonlyRefSignal,
} from 'react-refsignal';
import { ghostStyle } from '../styles/replay.styles';

export type Point = { x: number; y: number };

export function Ghost({
  source,
  ms,
  size,
  hue,
}: {
  source: ReadonlyRefSignal<Point>;
  ms: number;
  size: number;
  hue: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // snapshot `p => ({ ...p })` is required: the queue must hold the value the
  // pointer *was*, not a live reference that would always show the present.
  const ghost = useReplayRefSignal(source, ms, (p) => ({ ...p }));

  useRefSignalEffect(
    () => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate(${ghost.current.x - size / 2}px, ${
        ghost.current.y - size / 2
      }px)`;
    },
    [ghost],
    { frame: true },
  );

  return <div ref={ref} style={ghostStyle(size, hue)} />;
}
