import type { CSSProperties } from 'react';
import { bottomLegend } from '../../../common/styles';
import { font } from '../../../common/theme';

export const pageStyle: CSSProperties = {
  background:
    'radial-gradient(ellipse at center, #0b1530 0%, #070b1c 65%, #04050f 100%)',
  color: '#fff',
  height: '100vh',
  overflow: 'hidden',
  position: 'relative',
  fontFamily: font.sans,
  cursor: 'crosshair',
};

export const titleBlock: CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  pointerEvents: 'none',
  textAlign: 'center',
};

export const titleStyle: CSSProperties = {
  fontFamily: font.mono,
  fontSize: 40,
  fontWeight: 700,
  letterSpacing: 2,
  color: 'rgba(180, 214, 255, 0.35)',
};

export const hintStyle: CSSProperties = {
  fontSize: 13,
  opacity: 0.5,
  maxWidth: 380,
  lineHeight: 1.6,
};

export const legendStyle: CSSProperties = {
  ...bottomLegend,
  maxWidth: 560,
  pointerEvents: 'none',
};

export const canvasStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};

export const fpsWrap: CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 16,
  zIndex: 100,
};

export const headStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: 'radial-gradient(circle at 35% 30%, #ffffff, #7fd6ff 70%)',
  boxShadow: '0 0 24px rgba(127, 214, 255, 0.9)',
  pointerEvents: 'none',
  willChange: 'transform',
};

// Per-ghost gradient + glow scale with the ghost's size and hue.
export function ghostStyle(size: number, hue: number): CSSProperties {
  return {
    position: 'fixed',
    top: 0,
    left: 0,
    width: size,
    height: size,
    borderRadius: '50%',
    background: `radial-gradient(circle at 35% 30%, hsl(${hue} 95% 72%), hsl(${hue} 85% 52%))`,
    boxShadow: `0 0 ${size * 0.9}px hsl(${hue} 90% 60% / 0.55)`,
    pointerEvents: 'none',
    willChange: 'transform',
  };
}
