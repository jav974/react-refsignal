// CallLines — one <line> per agent, drawn while that agent is broadcasting a
// call. Each line follows the caller's position, the call signal, and the
// CALLED target's position — the last of which has dynamic identity (it
// changes whenever the agent re-targets), so we use `trackSignals` to
// re-subscribe automatically. This is the inter-agent comms made visible.

import { useRef } from 'react';
import { useRefSignalEffect } from 'react-refsignal';
import type { Agent } from '../types';

export function CallLines({ agents }: { agents: Agent[] }) {
  return (
    <g>
      {agents.map((a) => (
        <CallLine key={a.id} agent={a} agents={agents} />
      ))}
    </g>
  );
}

function CallLine({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const ref = useRef<SVGLineElement>(null);

  useRefSignalEffect(
    () => {
      const el = ref.current;
      if (!el) return;
      const targetId = agent.callTarget.current;
      if (targetId === null || !agent.alive.current) {
        el.style.display = 'none';
        return;
      }
      const target = agents[targetId];
      if (!target || !target.alive.current) {
        el.style.display = 'none';
        return;
      }
      const ap = agent.position.current;
      const tp = target.position.current;
      el.style.display = '';
      el.setAttribute('x1', ap.x.toFixed(1));
      el.setAttribute('y1', ap.y.toFixed(1));
      el.setAttribute('x2', tp.x.toFixed(1));
      el.setAttribute('y2', tp.y.toFixed(1));
      el.setAttribute('stroke', `hsl(${agent.hue} 70% 60%)`);
    },
    [agent.callTarget, agent.alive],
    {
      // Positions move every tick, so subscribing to them statically would fire
      // this effect 360×/tick — even for the (majority) agents whose line is
      // hidden. Instead, track the caller's AND the called target's position
      // only while a call is live; an idle line then re-runs solely on its own
      // call-state / alive changes. trackSignals also re-subscribes to the new
      // target's signals when callTarget swaps. Cost scales with calls, not N.
      trackSignals: () => {
        const id = agent.callTarget.current;
        if (id === null) return [];
        const target = agents[id];
        return target ? [agent.position, target.position, target.alive] : [];
      },
    },
  );

  return (
    <line
      ref={ref}
      stroke="white"
      strokeOpacity={0.4}
      strokeWidth={1.2}
      strokeDasharray="3 4"
      pointerEvents="none"
      style={{ display: 'none' }}
    />
  );
}
