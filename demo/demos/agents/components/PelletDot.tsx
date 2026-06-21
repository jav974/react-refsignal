// PelletDot — minimal: opacity flip on alive change, cx/cy move on respawn.
import { useRef } from 'react';
import { useRefSignalEffect } from 'react-refsignal';
import type { Pellet } from '../types';

export function PelletDot({ pellet }: { pellet: Pellet }) {
  const ref = useRef<SVGCircleElement>(null);

  useRefSignalEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = pellet.alive.current ? '1' : '0';
    // On respawn, x/y were mutated before alive flipped to true — reflect them.
    el.setAttribute('cx', String(pellet.x));
    el.setAttribute('cy', String(pellet.y));
  }, [pellet.alive]);

  return (
    <circle
      ref={ref}
      cx={pellet.x}
      cy={pellet.y}
      r={2.5}
      fill="rgba(255, 220, 100, 0.85)"
    />
  );
}
