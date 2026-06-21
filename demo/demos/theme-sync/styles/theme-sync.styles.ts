// Many styles here take the live `accent`/`bg` because the whole page is the
// theme it's editing — those are factories; the rest are plain objects.

import type { CSSProperties } from 'react';
import { font } from '../../../common/theme';

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  padding: '40px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  fontFamily: font.sans,
};

export const fieldsRow: CSSProperties = {
  display: 'flex',
  gap: 24,
  flexWrap: 'wrap',
};
export const presetRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};
export const badgeRow: CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
};

export const sectionLabel: CSSProperties = {
  fontSize: 12,
  opacity: 0.6,
  marginBottom: 8,
};

export function presetBtn(
  bg: string,
  fg: string,
  accent: string,
): CSSProperties {
  return {
    padding: '10px 16px',
    border: `2px solid ${accent}`,
    borderRadius: 6,
    background: bg,
    color: fg,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    transition: 'transform 100ms',
  };
}

export function broadcasterSection(accent: string): CSSProperties {
  return {
    marginTop: 12,
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${accent}44`,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };
}

export const broadcasterHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

export function broadcastingBadge(accent: string, bg: string): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    background: accent,
    color: bg,
    fontSize: 12,
    fontWeight: 700,
  };
}

export const listeningBadge: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.08)',
  fontSize: 12,
  fontWeight: 700,
  opacity: 0.7,
};

export function statusInput(active: boolean, accent: string): CSSProperties {
  return {
    padding: '10px 14px',
    fontSize: 14,
    border: `1px solid ${active ? accent : 'rgba(255,255,255,0.15)'}`,
    borderRadius: 6,
    background: 'transparent',
    color: 'inherit',
    opacity: active ? 1 : 0.6,
    cursor: active ? 'text' : 'not-allowed',
  };
}

export function footerStyle(accent: string): CSSProperties {
  return {
    marginTop: 'auto',
    fontSize: 12,
    opacity: 0.5,
    borderTop: `1px solid ${accent}33`,
    paddingTop: 12,
  };
}

// ColorField
export const colorFieldLabel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
export const colorFieldCaption: CSSProperties = { fontSize: 12, opacity: 0.6 };
export const colorFieldRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
export const swatchInput: CSSProperties = {
  width: 42,
  height: 32,
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
};
export const hexInput: CSSProperties = {
  padding: '6px 10px',
  fontFamily: font.mono,
  fontSize: 13,
  border: '1px solid currentColor',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  width: 100,
};

// Badge
export const badgeStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
