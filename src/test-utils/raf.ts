/**
 * Stubs `requestAnimationFrame` / `cancelAnimationFrame` so tests can drive
 * frames deterministically via `fire()`. Call `restore()` when done (typically
 * at the end of the test or in `afterEach`).
 *
 * Works in both jsdom and node environments — falls back to direct assignment
 * when `globalThis.requestAnimationFrame` is undefined (node has no rAF).
 *
 * @example
 * const raf = setupRafMock();
 * try {
 *   runMyCode();
 *   raf.fire();          // executes the captured callback
 *   expect(...).toBe(...);
 * } finally {
 *   raf.restore();
 * }
 */
export function setupRafMock() {
  let rafCallback: FrameRequestCallback | null = null;
  const g = globalThis as unknown as {
    requestAnimationFrame?: typeof requestAnimationFrame;
    cancelAnimationFrame?: typeof cancelAnimationFrame;
  };
  const rafExisted = g.requestAnimationFrame !== undefined;
  const cafExisted = g.cancelAnimationFrame !== undefined;

  // jest.spyOn requires the property to exist — node env has no rAF/cAF,
  // so pre-assign a dummy before spying, then delete on restore.
  if (!rafExisted) g.requestAnimationFrame = (() => 0) as never;
  if (!cafExisted) g.cancelAnimationFrame = (() => {}) as never;

  const rafSpy = jest
    .spyOn(g, 'requestAnimationFrame')
    .mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
  const cafSpy = jest
    .spyOn(g, 'cancelAnimationFrame')
    .mockImplementation(() => {});

  return {
    fire(time = 0) {
      rafCallback?.(time);
    },
    restore() {
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      if (!rafExisted) delete g.requestAnimationFrame;
      if (!cafExisted) delete g.cancelAnimationFrame;
    },
  };
}
