import type { CSSProperties } from 'react';

export const colors = {
  bg: '#1a1d23',
  bgAlt: '#22262e',
  border: '#2e333d',
  borderLight: '#3a4151',
  text: '#d6d9e0',
  textMuted: '#8a8f99',
  accent: '#5ea8ff',
  accentDim: '#3b5a8a',
  success: '#5dd58a',
  warn: '#e6b85a',
  error: '#ef6b6b',
  trace: '#9a64e6',
};

export const dock = (height: number, isCollapsed: boolean): CSSProperties => ({
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  height: isCollapsed ? 32 : height,
  background: colors.bg,
  color: colors.text,
  borderTop: `1px solid ${colors.border}`,
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  zIndex: 2147483000,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.35)',
});

export const dragHandle: CSSProperties = {
  height: 4,
  cursor: 'ns-resize',
  background: 'transparent',
  borderTop: `1px solid ${colors.borderLight}`,
};

export const dragHandleActive: CSSProperties = {
  ...dragHandle,
  background: colors.accent,
};

export const tabBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 28,
  background: colors.bgAlt,
  borderBottom: `1px solid ${colors.border}`,
  padding: '0 4px',
  gap: 2,
  flexShrink: 0,
};

export const tab = (active: boolean): CSSProperties => ({
  background: active ? colors.bg : 'transparent',
  color: active ? colors.text : colors.textMuted,
  border: 'none',
  borderRadius: '4px 4px 0 0',
  padding: '4px 10px',
  fontSize: 11,
  fontFamily: 'inherit',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
});

export const spacer: CSSProperties = { flex: 1 };

export const chip = (color: string): CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 3,
  background: color,
  color: colors.bg,
  fontSize: 10,
  fontWeight: 600,
  marginRight: 4,
});

export const iconBtn: CSSProperties = {
  background: 'transparent',
  color: colors.textMuted,
  border: 'none',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
};

export const controlBtn: CSSProperties = {
  background: colors.bg,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  cursor: 'pointer',
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'inherit',
};

export const rateSelect: CSSProperties = {
  background: colors.bg,
  color: colors.textMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  padding: '2px 6px',
  fontSize: 10,
  fontFamily: 'inherit',
  marginRight: 6,
  cursor: 'pointer',
};

export const content: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 8,
};

export const empty: CSSProperties = {
  color: colors.textMuted,
  fontStyle: 'italic',
  padding: 16,
  textAlign: 'center',
};

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.textMuted,
  fontWeight: 600,
  fontSize: 11,
  position: 'sticky',
  top: 0,
  background: colors.bgAlt,
  cursor: 'pointer',
  userSelect: 'none',
};

export const td: CSSProperties = {
  padding: '3px 8px',
  borderBottom: `1px solid ${colors.border}`,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 320,
};

export const tdMono: CSSProperties = {
  ...td,
  fontFamily: 'inherit',
  color: colors.accent,
};

export const card: CSSProperties = {
  background: colors.bgAlt,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  padding: 8,
  marginBottom: 8,
};

export const cardTitle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 6,
  color: colors.text,
};

export const cardRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '2px 0',
  fontSize: 11,
};

export const cardLabel: CSSProperties = {
  color: colors.textMuted,
};

export const statusOk: CSSProperties = {
  ...chip(colors.success),
};
export const statusWarn: CSSProperties = {
  ...chip(colors.warn),
};
export const statusError: CSSProperties = {
  ...chip(colors.error),
};

export const filterInput: CSSProperties = {
  background: colors.bgAlt,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  padding: '4px 8px',
  fontSize: 11,
  fontFamily: 'inherit',
  width: 200,
  marginBottom: 8,
};

export const sparkline: CSSProperties = {
  display: 'block',
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
};

export const diffOld: CSSProperties = {
  color: colors.error,
  marginRight: 8,
};

export const diffNew: CSSProperties = {
  color: colors.success,
};
