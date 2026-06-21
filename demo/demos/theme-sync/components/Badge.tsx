import type { ReactNode } from 'react';
import { badgeStyle } from '../styles/theme-sync.styles';

export function Badge({ children }: { children: ReactNode }) {
  return <div style={badgeStyle}>{children}</div>;
}
