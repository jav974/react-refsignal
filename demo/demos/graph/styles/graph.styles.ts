// Shared chrome for the three benchmark screens (svg / canvas / automated).
// The benchmark toolbar buttons dim to 0.6 (vs the common 0.75) — kept local
// so the inactive-mode contrast matches the original.

import type { CSSProperties } from 'react';
import { font } from '../../../common/theme';
import { pageShell } from '../../../common/styles';

// toolbarStyle + rightGroup are identical to the shared chrome — re-exported
// so the three benchmark screens keep importing layout from this one file.
export { rightGroup, toolbarStyle } from '../../../common/styles';

export const pageStyle: CSSProperties = {
  ...pageShell,
  background: '#1a1a2e',
  userSelect: 'none',
};

// Dimmer + tighter than the common hint — the benchmark wants the mode
// description to recede behind the live numbers.
export const hintStyle: CSSProperties = {
  padding: '3px 14px',
  fontSize: 11,
  opacity: 0.4,
  background: '#16213e',
  borderTop: '1px solid #1a1a2e',
};

export const nodesLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginLeft: 8,
  fontSize: 12,
};

export const countReadout: CSSProperties = {
  fontSize: 11,
  opacity: 0.5,
  fontFamily: font.mono,
};

export const svgContainer: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: 8,
};

export const canvasContainer: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 8,
  background: '#1a1a2e',
};

export function btnStyle(active: boolean, color: string): CSSProperties {
  return {
    padding: '5px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
    background: active ? color : '#333',
    color: '#fff',
    opacity: active ? 1 : 0.6,
    transition: 'opacity 0.15s',
  };
}

export const tdStyle: CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #334155',
  textAlign: 'left',
};
