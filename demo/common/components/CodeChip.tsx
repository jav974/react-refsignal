// Inline `<code>` chip — wraps the `codeChip` style so legends read as
// `<CodeChip>useRefSignalMemo</CodeChip>` instead of repeating the style prop.

import type { ReactNode } from 'react';
import { codeChip } from '../styles';

export function CodeChip({ children }: { children: ReactNode }) {
  return <code style={codeChip}>{children}</code>;
}
