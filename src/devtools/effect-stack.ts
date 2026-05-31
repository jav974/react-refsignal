import type { RefSignal } from '../refsignal';

export interface EffectFrame {
  effectId: string;
  depSignals: readonly RefSignal[];
}

const stack: EffectFrame[] = [];

export function pushEffect(frame: EffectFrame): void {
  stack.push(frame);
}

export function popEffect(effectId: string): void {
  const top = stack[stack.length - 1];
  if (!top || top.effectId !== effectId) {
    console.warn(
      `[refsignal devtools] effect-stack mismatch on pop: expected ${effectId}, top was ${top?.effectId ?? '<empty>'}`,
    );
    return;
  }
  stack.pop();
}

export function currentEffect(): EffectFrame | undefined {
  return stack[stack.length - 1];
}
