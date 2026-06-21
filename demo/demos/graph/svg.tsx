// Manual draggable-graph demo (SVG renderer) — all 9 modes. Crank the slider,
// drag a node, watch FPS + renders/sec. Body lives in ManualGraph, shared with
// the canvas route.

import { ManualGraph } from './components/ManualGraph';

export default function GraphBenchmark() {
  return <ManualGraph />;
}
