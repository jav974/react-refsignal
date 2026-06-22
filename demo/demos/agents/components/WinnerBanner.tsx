import { useRefSignalRender } from 'react-refsignal';
import { btnStyle } from '../../../common/styles';
import { TEAM_NAMES } from '../logic/config';
import { winnerCardStyle, winnerOverlayStyle } from '../styles/agents.styles';
import type { Agent } from '../types';

export function WinnerBanner({
  winner,
  onReset,
}: {
  winner: Agent;
  onReset: () => void;
}) {
  // Track winner's size — pellets keep adding mass post-victory.
  useRefSignalRender([winner.size]);
  return (
    <div style={winnerOverlayStyle}>
      <div style={winnerCardStyle}>
        <div style={{ fontSize: 12, opacity: 0.55, letterSpacing: 1 }}>
          WINNER
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 8,
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: `hsl(${winner.hue} 75% 55%)`,
              border: `2px solid hsl(${winner.hue} 60% 30%)`,
            }}
          />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{winner.name}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {TEAM_NAMES[winner.team]} · {winner.kills} kills ·{' '}
              {winner.size.current.toFixed(1)} mass
            </div>
          </div>
        </div>
        <button
          onClick={onReset}
          style={{ ...btnStyle(false, '#10b981'), marginTop: 14 }}
        >
          New round
        </button>
      </div>
    </div>
  );
}
