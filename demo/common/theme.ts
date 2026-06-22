// Shared design tokens for the demos. Per-demo page backgrounds stay local
// (each demo has its own mood); everything here is the common chrome —
// panels, accents, borders, fonts — that repeated verbatim across files.

export const color = {
  /** Primary accent — active nav, highlights, focus rings. */
  accent: '#4a9eff',
  /** Inset surfaces: badges, selects, panels-on-dark. */
  panel: '#0d1117',
  /** Toolbar / control-strip background. */
  toolbar: '#16213e',
  /** Control borders (selects, separators). */
  border: '#334155',
  /** Hairline border on translucent floating panels. */
  borderSoft: 'rgba(255,255,255,0.08)',
  text: '#fff',
  /** De-emphasized text: inactive nav, captions. */
  muted: '#9ca3af',
  /** Inline `<code>` chip background. */
  chip: 'rgba(255,255,255,0.1)',
} as const;

export const font = {
  sans: 'system-ui, sans-serif',
  mono: 'monospace',
} as const;
