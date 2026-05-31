/**
 * @jest-environment jsdom
 */
import { rateOptionsFor, RATE_PRESETS } from './state';

describe('overlay state', () => {
  it('rateOptionsFor returns the matching preset options', () => {
    for (const preset of RATE_PRESETS) {
      expect(rateOptionsFor(preset.id)).toBe(preset.options);
    }
  });

  it('rateOptionsFor falls back to a sane default for unknown ids', () => {
    const fallback = rateOptionsFor('not-a-preset' as never);
    expect(fallback).toEqual({ throttle: 100 });
  });
});
