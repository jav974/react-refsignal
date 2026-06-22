// Manual graph demo (Canvas renderer) — same 9 modes as svg.tsx, rendered
// through a single <canvas> per mode instead of an SVG element tree. Forces
// renderer="canvas" regardless of URL params.

import { ManualGraph } from './components/ManualGraph';

export default function GraphBenchmarkCanvas() {
  return <ManualGraph renderer="canvas" title="CANVAS" />;
}
