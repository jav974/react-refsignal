/**
 * Cap floating-point display precision to keep the SignalsPanel readable.
 * `performance.now()` and other high-precision floats otherwise render with
 * 13+ digits that change width every frame, causing column flicker. The
 * detail card still shows full precision via `JSON.stringify` separately.
 */
const FLOAT_DECIMALS = 3;
const formatNumber = (v: number): string => {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return v.toString();
  // Keep sub-millisecond precision for very small magnitudes where 3
  // decimals would round to zero (e.g. dt in seconds).
  if (v !== 0 && Math.abs(v) < 1e-3) return v.toString();
  return v.toFixed(FLOAT_DECIMALS);
};

const stringifyWithPrecisionCap = (
  v: unknown,
  seen: WeakSet<object> = new WeakSet(),
): string | undefined => {
  if (typeof v === 'number') return formatNumber(v);
  // Walk arrays/objects to apply the cap recursively. Other types fall back
  // to JSON.stringify's native handling via the caller.
  if (Array.isArray(v)) {
    if (seen.has(v)) return undefined;
    seen.add(v);
    return `[${v.map((x) => stringifyWithPrecisionCap(x, seen) ?? 'null').join(',')}]`;
  }
  if (v !== null && typeof v === 'object') {
    if (seen.has(v)) return undefined;
    seen.add(v);
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) =>
        `${JSON.stringify(k)}:${stringifyWithPrecisionCap(val, seen) ?? 'null'}`,
    );
    return `{${entries.join(',')}}`;
  }
  try {
    return (JSON.stringify(v) as string | undefined) ?? undefined;
  } catch {
    return undefined;
  }
};

export const formatValue = (v: unknown, max = 120): string => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return 'fn()';
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'bigint') return `${v.toString()}n`;
  const str = stringifyWithPrecisionCap(v);
  if (str === undefined) return '[unstringifiable]';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
};

export const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
};

/**
 * Render a timestamp as a relative age.
 *
 * - Default (`compact: false`): verbose with "ago" suffix and minute-level
 *   granularity — for card labels (`"145ms ago"`, `"3s ago"`, `"2m ago"`).
 * - `compact: true`: no suffix, minute+second precision — for tight columns
 *   like the timeline (`"145ms"`, `"3s"`, `"2m30s"`).
 */
export const ago = (t: number, opts?: { compact?: boolean }): string => {
  const ms = Date.now() - t;
  const compact = opts?.compact === true;
  const suffix = compact ? '' : ' ago';
  if (ms < 1000) return `${ms.toString()}ms${suffix}`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec.toString()}s${suffix}`;
  const min = Math.floor(sec / 60);
  if (compact) return `${min.toString()}m${(sec % 60).toString()}s`;
  return `${min.toString()}m ago`;
};
