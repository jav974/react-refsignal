import {
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderHookResult,
} from '@testing-library/react';

// Local wrapper: RTL's renderHook has 5 generics (3 with defaults) and some IDEs
// fail to infer the defaults, flagging every call with "Type argument cannot be
// inferred from usage". This 2-generic wrapper keeps the same runtime behavior
// while letting the IDE infer cleanly.
export function renderHook<Result, Props = never>(
  render: (props: Props) => Result,
  options?: Pick<RenderHookOptions<Props>, 'initialProps' | 'wrapper'>,
): RenderHookResult<Result, Props> {
  return rtlRenderHook(render, options);
}
