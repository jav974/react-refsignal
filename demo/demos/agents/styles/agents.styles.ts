import type { CSSProperties } from 'react';
import { glassPanel, pageShell } from '../../../common/styles';

// Stats group (rightGroup) + panel heading are shared chrome — re-exported so
// agents components keep importing styles from this one file.
export { panelHeading, rightGroup } from '../../../common/styles';

export const pageStyle: CSSProperties = {
  ...pageShell,
  background: '#0a0d18',
  userSelect: 'none',
};

export const stageStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  position: 'relative',
};

export function stageSvgStyle(controlled: boolean): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: controlled ? 'crosshair' : 'default',
  };
}

// Floating glass panel, pinned to a corner. `offset` is the inset distance.
export function panelStyle(
  corner: 'top' | 'left' | 'bottom-right',
  offset: number,
): CSSProperties {
  const base: CSSProperties = {
    ...glassPanel,
    padding: '10px 14px',
    minWidth: 170,
  };
  if (corner === 'top') return { ...base, top: offset, right: offset };
  if (corner === 'left') return { ...base, top: offset, left: offset };
  return { ...base, bottom: offset, right: offset };
}

// The kill feed lives bottom-right like the nav + devtools dock — so park it
// above both instead of overlapping. bottom = dock height + nav height + gaps
// (12 for the nav's own gap above the dock, 12 between nav and feed).
export const feedPanelStyle: CSSProperties = {
  ...glassPanel,
  padding: '10px 14px',
  minWidth: 170,
  right: 12,
  bottom:
    'calc(var(--refsignal-devtools-height, 0px) + var(--demo-nav-height, 0px) + 24px)',
};

export const leaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

export const rankCell: CSSProperties = {
  width: 14,
  opacity: 0.5,
  fontSize: 10,
  fontFamily: 'monospace',
};

// Ellipsized agent name inside the leaderboard rows.
export const leaderName: CSSProperties = {
  fontSize: 11,
  opacity: 0.85,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const leaderMass: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
};

export const killRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 3,
};

export const emptyFeed: CSSProperties = {
  opacity: 0.35,
  fontSize: 11,
  fontStyle: 'italic',
};

export const winnerOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
};

export const winnerCardStyle: CSSProperties = {
  background: '#0d1117',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  padding: '24px 30px',
  minWidth: 320,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};

// SpeedControl readout.
export const speedReadout: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  opacity: 0.7,
  minWidth: 36,
  textAlign: 'right',
};

// Small hue dot used in the leaderboard + killcam.
export function hueDot(hue: number): CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: `hsl(${hue} 70% 55%)`,
    border: '1px solid rgba(0,0,0,0.4)',
    flexShrink: 0,
  };
}

// One team row in the scoreboard. Dims + strikes through when eliminated.
export function teamRow(eliminated: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 0',
    opacity: eliminated ? 0.3 : 1,
    textDecoration: eliminated ? 'line-through' : 'none',
  };
}

export function teamSwatch(hue: number): CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: 2,
    background: `hsl(${hue} 70% 55%)`,
  };
}

export const teamName: CSSProperties = { fontSize: 11, flex: 1 };
export const teamCount: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  opacity: 0.7,
  minWidth: 30,
  textAlign: 'right',
};
export const teamMass: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  color: '#4a9eff',
  minWidth: 36,
  textAlign: 'right',
};
