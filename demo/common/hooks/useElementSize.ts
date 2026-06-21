import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

// Measures an element's box and tracks it across window resizes. Measures once
// post-paint (rAF, so layout has settled) and on every `resize`, flooring to
// whole pixels and only updating state when the size actually changes — so the
// returned `size` object keeps a stable identity until it does (safe to drop
// straight into a deps array). `fallback` seeds the pre-measure value and may
// be a thunk to read `window` lazily. Returns the `ref` to attach + the size.
export function useElementSize<T extends HTMLElement = HTMLDivElement>(
  fallback: Size | (() => Size),
): { ref: RefObject<T | null>; size: Size } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>(fallback);

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.floor(r.width);
      const height = Math.floor(r.height);
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    // Measure post-paint; only re-measure on viewport resize, not reflows.
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return { ref, size };
}
