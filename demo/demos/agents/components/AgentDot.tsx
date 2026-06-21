// AgentDot — vision ring + body + name. Three per-signal effects (position,
// size, alive) write the SVG directly — no per-frame React renders.

import { useRef } from 'react';
import { useRefSignalEffect } from 'react-refsignal';
import { VISION } from '../logic/config';
import { radiusOf } from '../logic/simulation';
import type { Agent } from '../types';

export function AgentDot({
  agent,
  showName,
  showVision,
  controlled,
  onTakeControl,
}: {
  agent: Agent;
  showName: boolean;
  showVision: boolean;
  controlled: boolean;
  onTakeControl: (id: number) => void;
}) {
  const gRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGCircleElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const fill = `hsl(${agent.hue} 75% 55%)`;
  const stroke = `hsl(${agent.hue} 60% 30%)`;
  const initialP = agent.position.current;
  const initialR = radiusOf(agent.size.current);

  useRefSignalEffect(() => {
    const g = gRef.current;
    if (!g) return;
    const p = agent.position.current;
    g.setAttribute(
      'transform',
      `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`,
    );
  }, [agent.position]);

  useRefSignalEffect(() => {
    const r = radiusOf(agent.size.current);
    bodyRef.current?.setAttribute('r', r.toFixed(1));
    textRef.current?.setAttribute('y', String(-(r + 4)));
    haloRef.current?.setAttribute('r', (r + 8).toFixed(1));
  }, [agent.size]);

  useRefSignalEffect(() => {
    const g = gRef.current;
    if (g) g.style.opacity = agent.alive.current ? '1' : '0';
  }, [agent.alive]);

  return (
    <g
      ref={gRef}
      transform={`translate(${initialP.x},${initialP.y})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onTakeControl(agent.id);
      }}
    >
      {showVision && (
        <circle
          r={VISION}
          fill="none"
          stroke={fill}
          strokeOpacity={0.04}
          strokeWidth={1}
        />
      )}
      {controlled && (
        <circle
          ref={haloRef}
          r={initialR + 8}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.7}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      <circle
        ref={bodyRef}
        r={initialR}
        fill={fill}
        stroke={controlled ? '#fff' : stroke}
        strokeWidth={controlled ? 2.5 : 1.5}
      />
      {showName && (
        <text
          ref={textRef}
          y={-(initialR + 4)}
          textAnchor="middle"
          fontSize={9}
          fontFamily="system-ui, sans-serif"
          fontWeight={600}
          fill="rgba(255,255,255,0.85)"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={2}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {agent.name}
        </text>
      )}
    </g>
  );
}
