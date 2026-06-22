import type { CSSProperties } from 'react';
import { pageShell } from '../../../common/styles';
import { DEAD } from '../logic/color';

// Stats group is the shared right-aligned flex group.
export { rightGroup } from '../../../common/styles';

export const pageStyle: CSSProperties = {
  ...pageShell,
  background: '#1a1a2e',
  userSelect: 'none',
};

export const tinyMono: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  opacity: 0.7,
  minWidth: 32,
};

// Segmented DOM/Canvas toggle — child buttons get borderRadius: 0.
export const modeToggle: CSSProperties = {
  display: 'flex',
  gap: 0,
  borderRadius: 6,
  overflow: 'hidden',
};

export const stageStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: 8,
};

export function domGridStyle(w: number, h: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${w}, 1fr)`,
    gridTemplateRows: `repeat(${h}, 1fr)`,
    gap: 1,
    background: '#1e293b',
    width: '100%',
    height: '100%',
    aspectRatio: '1 / 1',
    margin: '0 auto',
    maxHeight: '100%',
    maxWidth: 'min(100%, calc(100vh - 140px))',
    touchAction: 'none',
    userSelect: 'none',
  };
}

export const canvasGridStyle: CSSProperties = {
  imageRendering: 'pixelated',
  width: '100%',
  height: '100%',
  display: 'block',
  background: DEAD,
  touchAction: 'none',
  userSelect: 'none',
};
