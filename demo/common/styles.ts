// Shared style objects + factories. These collapse the copies that lived at
// the bottom of nearly every demo file (codeStyle ×6, pageStyle ×5, the
// toolbar/hint/slider/select strip, and btnStyle). Demos spread these and
// override the few demo-specific bits (notably each page's `background`).

import type { CSSProperties } from 'react';
import { color, font } from './theme';

/** Inline `<code>` chip used throughout legends and hints. */
export const codeChip: CSSProperties = {
  padding: '1px 6px',
  borderRadius: 3,
  fontFamily: font.mono,
  fontSize: 11,
  background: color.chip,
};

/**
 * Base full-viewport page chrome: dark text, column flex, sans font. Demos
 * spread this and add their own `background` (each demo has a distinct mood)
 * plus layout specifics — `userSelect: 'none'` for draggable canvases,
 * centering for the showpiece demos, etc.
 */
export const pageShell: CSSProperties = {
  color: color.text,
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: font.sans,
};

/** Horizontal control strip at the top of the interactive demos. */
export const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  background: color.toolbar,
  flexWrap: 'wrap',
};

/** Caption strip (usually below the toolbar). */
export const hintStyle: CSSProperties = {
  padding: '4px 14px',
  fontSize: 11,
  opacity: 0.55,
  background: color.toolbar,
  borderTop: '1px solid #1a1a2e',
  lineHeight: 1.5,
};

/** Label wrapping a range slider in the toolbar. */
export const sliderLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  opacity: 0.85,
};

/** Dark `<select>` matching the toolbar. */
export const selectStyle: CSSProperties = {
  background: color.panel,
  color: color.text,
  border: `1px solid ${color.border}`,
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 12,
};

/** Vertical separator between toolbar control groups. */
export const separator: CSSProperties = {
  width: 1,
  height: 20,
  background: color.border,
};

/** Pushes a flex group (usually the stats) to the right end of its row. */
export const rightGroup: CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  gap: 8,
};

/**
 * Floating translucent panel pinned over a canvas (leaderboards, the bones
 * inspector). Spread it and add corner placement + padding/min-width.
 */
export const glassPanel: CSSProperties = {
  position: 'absolute',
  background: 'rgba(13, 17, 23, 0.85)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
};

/** Small uppercase section heading inside a glass panel. */
export const panelHeading: CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  marginBottom: 8,
  letterSpacing: 1,
  fontWeight: 700,
};

/** Fixed, centered caption strip along the bottom of a full-screen demo. */
export const bottomLegend: CSSProperties = {
  position: 'fixed',
  bottom: 64,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 12,
  opacity: 0.55,
  textAlign: 'center',
  lineHeight: 1.6,
};

/** Toolbar pill button. `disabled` dims and blocks the cursor. */
export function btnStyle(
  active: boolean,
  accent: string,
  disabled = false,
): CSSProperties {
  return {
    padding: '5px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    fontSize: 12,
    background: active ? accent : '#333',
    color: '#fff',
    opacity: disabled ? 0.3 : active ? 1 : 0.75,
    transition: 'opacity 0.15s',
  };
}
