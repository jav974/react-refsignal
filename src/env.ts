/**
 * True when running a production build — gates dev-only warnings and devtools
 * activation. A function (not a module-load const) so call sites observe
 * runtime changes to NODE_ENV (tests, SSR frameworks that set it late).
 */
export const isProd = (): boolean =>
  typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
