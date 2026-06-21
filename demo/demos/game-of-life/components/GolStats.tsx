import { useRefSignalRender, type ReadonlyRefSignal } from 'react-refsignal';
import { Stat } from '../../../common/components/Stat';

export interface GolStatsValue {
  alive: number;
  changed: number;
  rps: number;
}

// Live counters isolated into a signal-subscribing leaf, so the per-tick
// updates re-render only this badge group — never GameOfLife (which would
// re-create the 6,400–10,000-cell grid). Same move as the agents demo's
// TickStat: keep the high-frequency churn off the big subtree, the signal way.
export function GolStats({
  tickN,
  stats,
  total,
}: {
  tickN: ReadonlyRefSignal<number>;
  stats: ReadonlyRefSignal<GolStatsValue>;
  total: number;
}) {
  useRefSignalRender([tickN, stats], { frame: true });
  const { alive, changed, rps } = stats.current;
  const changedPct = total > 0 ? ((changed / total) * 100).toFixed(1) : '0';
  return (
    <>
      <Stat label="tick" value={tickN.current} />
      <Stat label="alive" value={`${alive}/${total}`} />
      <Stat
        label="changed/tick"
        value={`${changed} (${changedPct}%)`}
        highlight
      />
      <Stat label="renders/s" value={rps || '--'} />
    </>
  );
}
