import { currentEffect, popEffect, pushEffect } from './effect-stack';

describe('effect-stack', () => {
  afterEach(() => {
    // Drain whatever a failing test left behind.
    while (currentEffect()) {
      popEffect(currentEffect()!.effectId);
    }
  });

  it('pushes and pops in LIFO order', () => {
    pushEffect({ effectId: 'a', depSignals: [] });
    pushEffect({ effectId: 'b', depSignals: [] });
    expect(currentEffect()?.effectId).toBe('b');
    popEffect('b');
    expect(currentEffect()?.effectId).toBe('a');
    popEffect('a');
    expect(currentEffect()).toBeUndefined();
  });

  it('warns when popEffect receives a mismatched id (top is different)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow */
    });
    pushEffect({ effectId: 'a', depSignals: [] });
    popEffect('mismatched');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('effect-stack mismatch'),
    );
    expect(currentEffect()?.effectId).toBe('a');
    warn.mockRestore();
    popEffect('a');
  });

  it('warns when popEffect runs against an empty stack', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow */
    });
    popEffect('orphan');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('<empty>'));
    warn.mockRestore();
  });
});
