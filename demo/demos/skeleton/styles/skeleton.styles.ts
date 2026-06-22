import type { CSSProperties } from 'react';
import { glassPanel, pageShell } from '../../../common/styles';

// Shared with the agents panels — re-exported so this file stays the one
// import source for skeleton components.
export { panelHeading } from '../../../common/styles';

export const pageStyle: CSSProperties = {
  ...pageShell,
  background: '#07080f',
  userSelect: 'none',
};

export const svgStyle: CSSProperties = {
  width: '100%',
  flex: 1,
  display: 'block',
  cursor: 'crosshair',
  background: 'radial-gradient(ellipse at 30% 40%, #131a2c 0%, #07080f 80%)',
};

export const legendStyle: CSSProperties = {
  padding: '10px 18px',
  fontSize: 12,
  opacity: 0.7,
  background: '#0d1117',
  borderBottom: '1px solid #1a1a2e',
  lineHeight: 1.55,
};

export const panelStyle: CSSProperties = {
  ...glassPanel,
  top: 80,
  right: 16,
  padding: '12px 16px',
  minWidth: 220,
};

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: 11,
  padding: '3px 0',
};

export const col0: CSSProperties = { flex: 1 };
export const col1: CSSProperties = {
  minWidth: 60,
  textAlign: 'right',
  fontSize: 11,
};

// First column with the ◀ handle indicator + label.
export const nameCell: CSSProperties = {
  ...col0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

// The fixed-width ◀ indicator slot.
export const handleArrow: CSSProperties = {
  display: 'inline-block',
  width: 8,
  textAlign: 'center',
  color: '#fbbf24',
};
