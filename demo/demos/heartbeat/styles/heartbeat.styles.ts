import type { CSSProperties } from 'react';
import { bottomLegend, pageShell } from '../../../common/styles';

export const pageStyle: CSSProperties = {
  ...pageShell,
  background:
    'radial-gradient(ellipse at center, #2a1020 0%, #0d0716 70%, #06030f 100%)',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 28,
  padding: 24,
};

export const circleStyle: CSSProperties = {
  width: 140,
  height: 140,
  borderRadius: '50%',
  background:
    'radial-gradient(circle at 35% 30%, #ff7b8b, #c92a3a 60%, #7a0a16)',
  boxShadow:
    '0 0 60px rgba(255, 107, 107, 0.45), inset 0 0 30px rgba(0,0,0,0.2)',
  willChange: 'transform',
};

export const infoBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
};

// Fixed top-center mode switch — sits above the centered hero without
// disturbing its vertical centering.
export const modeToggle: CSSProperties = {
  position: 'fixed',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  zIndex: 10,
};

export function modeBtn(active: boolean): CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    background: active ? '#c92a3a' : 'transparent',
    color: active ? '#fff' : 'rgba(255,255,255,0.6)',
    transition: 'background 0.15s, color 0.15s',
  };
}

export const bpmStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: 1,
  color: '#ff8a9c',
  textShadow: '0 0 20px rgba(255, 107, 107, 0.5)',
};

export const hintStyle: CSSProperties = {
  fontSize: 13,
  opacity: 0.7,
  maxWidth: 320,
  textAlign: 'center',
};

export const legendStyle: CSSProperties = { ...bottomLegend, maxWidth: 540 };
