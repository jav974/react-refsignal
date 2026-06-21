// Monospace stat pill — `label <b>value</b>`. Highlighted variant draws an
// accent border + accent value, used to flag the live/leading figure.
// Unified from the identical copies that lived in agents + game-of-life.

import type { CSSProperties } from 'react';
import { color, font } from '../theme';

export function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <span style={highlight ? statHighlight : statBase}>
      {label}{' '}
      <b style={{ color: highlight ? color.accent : color.text }}>{value}</b>
    </span>
  );
}

const statBase: CSSProperties = {
  background: color.panel,
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: font.mono,
  border: '1px solid transparent',
};

const statHighlight: CSSProperties = {
  ...statBase,
  border: `1px solid ${color.accent}`,
};
