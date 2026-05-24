import { ago, formatValue, typeOf } from './format';

describe('formatValue', () => {
  it('handles null and undefined', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
  });

  it('renders functions as "fn()"', () => {
    expect(formatValue(() => undefined)).toBe('fn()');
  });

  it('renders symbols via toString', () => {
    expect(formatValue(Symbol('s'))).toBe('Symbol(s)');
  });

  it('renders bigints with the n suffix', () => {
    expect(formatValue(BigInt(42))).toBe('42n');
  });

  it('renders integers as-is', () => {
    expect(formatValue(123)).toBe('123');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(-7)).toBe('-7');
  });

  it('caps non-integer floats to 3 decimals', () => {
    expect(formatValue(1.234567890123)).toBe('1.235');
    expect(formatValue(performance.now())).toMatch(/^\d+\.\d{3}$/);
  });

  it('keeps very small magnitudes at full precision', () => {
    expect(formatValue(0.0001234)).toBe('0.0001234');
  });

  it('preserves zero as the integer "0"', () => {
    expect(formatValue(0)).toBe('0');
  });

  it('handles non-finite numbers (Infinity, NaN)', () => {
    expect(formatValue(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(formatValue(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
    expect(formatValue(Number.NaN)).toBe('NaN');
  });

  it('recursively caps numbers inside arrays', () => {
    expect(formatValue([1.234567, 2.345678])).toBe('[1.235,2.346]');
  });

  it('recursively caps numbers inside objects', () => {
    expect(formatValue({ x: 1.234567, y: 2.345678 })).toBe(
      '{"x":1.235,"y":2.346}',
    );
  });

  it('truncates strings that exceed max length', () => {
    const long = 'a'.repeat(200);
    const out = formatValue(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).toMatch(/…$/);
  });

  it('treats undefined values inside arrays as null (JSON convention)', () => {
    expect(formatValue([undefined, 1])).toBe('[null,1]');
  });

  it('breaks circular references without crashing (renders cycle as null)', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(formatValue(obj)).toBe('{"self":null}');
  });

  it('handles strings via JSON.stringify quoting', () => {
    expect(formatValue('hello')).toBe('"hello"');
  });

  it('catches JSON.stringify throws inside nested values (BigInt in array)', () => {
    // BigInt at top level has its own short-circuit, but a BigInt inside an
    // array hits the JSON.stringify branch in the recursive walker which
    // throws — exercises the catch arm.
    expect(formatValue([BigInt(1)])).toBe('[null]');
  });
});

describe('typeOf', () => {
  it('returns "null" for null', () => {
    expect(typeOf(null)).toBe('null');
  });

  it('returns "array" for arrays', () => {
    expect(typeOf([1, 2, 3])).toBe('array');
  });

  it('returns typeof for everything else', () => {
    expect(typeOf(1)).toBe('number');
    expect(typeOf('s')).toBe('string');
    expect(typeOf({})).toBe('object');
    expect(typeOf(true)).toBe('boolean');
    expect(typeOf(undefined)).toBe('undefined');
  });
});

describe('ago', () => {
  it('renders ms granularity with "ago" suffix by default', () => {
    expect(ago(Date.now() - 150)).toMatch(/^\d+ms ago$/);
  });

  it('renders seconds with "ago" suffix', () => {
    expect(ago(Date.now() - 5_000)).toMatch(/^\d+s ago$/);
  });

  it('renders minutes with "ago" suffix (no seconds tail in verbose)', () => {
    expect(ago(Date.now() - 90_000)).toMatch(/^1m ago$/);
  });

  it('compact mode drops the suffix and includes seconds at minute level', () => {
    expect(ago(Date.now() - 200, { compact: true })).toMatch(/^\d+ms$/);
    expect(ago(Date.now() - 3_500, { compact: true })).toMatch(/^3s$/);
    expect(ago(Date.now() - 65_000, { compact: true })).toMatch(/^1m5s$/);
  });
});
