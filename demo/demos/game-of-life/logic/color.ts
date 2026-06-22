// Cell value is "age": 0 = dead, n > 0 = alive for n ticks. Age drives color:
// cyan (newborn) → green → yellow → orange → red (old). The DOM renderer uses
// the CSS string; the canvas renderer uses the packed-u32 LUT.

export const DEAD = '#0b0d18';
const DEAD_RGB: [number, number, number] = [0x0b, 0x0d, 0x18];

// Age → HSL. Sweep cyan (newborn) → green → yellow → orange → red (old).
function hslAtAge(age: number): { h: number; s: number; l: number } {
  const t = Math.min(1, age / 30);
  return {
    h: 190 - t * 190,
    s: 85,
    l: 45 + (1 - t) * 15,
  };
}

export function ageColor(age: number): string {
  if (age === 0) return DEAD;
  const { h, s, l } = hslAtAge(age);
  return `hsl(${h.toFixed(0)}, ${s}%, ${l.toFixed(0)}%)`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ABGR little-endian LUT for canvas pixel writes. Ages > 30 clamp to red.
const COLOR_LUT_U32: Uint32Array = (() => {
  const lut = new Uint32Array(31);
  const pack = (r: number, g: number, b: number) =>
    ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
  lut[0] = pack(...DEAD_RGB);
  for (let i = 1; i <= 30; i++) {
    const { h, s, l } = hslAtAge(i);
    const [r, g, b] = hslToRgb(h, s, l);
    lut[i] = pack(r, g, b);
  }
  return lut;
})();

export function ageColorU32(age: number): number {
  return COLOR_LUT_U32[Math.min(age, 30)];
}
