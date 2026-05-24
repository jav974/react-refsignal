import { devtools } from '../../adapter';
import { ago } from '../format';
import * as s from '../styles';
import { useDevtoolsRender } from '../useDevtoolsRender';

interface PersistState {
  key: string;
  scope: 'signal' | 'store';
  hydrated: boolean;
  hydrationMs?: number;
  hadStoredValue?: boolean;
  signalCount?: number;
  writeCount: number;
  lastWriteAt?: number;
}

const collect = (): PersistState[] => {
  const byKey = new Map<string, PersistState>();
  const ensure = (key: string, scope: 'signal' | 'store'): PersistState => {
    let st = byKey.get(key);
    if (!st) {
      st = { key, scope, hydrated: false, writeCount: 0 };
      byKey.set(key, st);
    }
    return st;
  };

  for (const e of devtools.getEvents()) {
    if (e.kind === 'persist:hydrate') {
      const st = ensure(e.key as string, e.scope as 'signal' | 'store');
      st.hydrated = true;
      st.hydrationMs = e.durationMs as number;
      st.hadStoredValue = e.hadValue as boolean;
      st.signalCount = e.signalCount as number | undefined;
    } else if (e.kind === 'persist:write') {
      const st = ensure(e.key as string, e.scope as 'signal' | 'store');
      st.writeCount += 1;
      st.lastWriteAt = e.t;
      if (st.signalCount === undefined && e.signalCount !== undefined) {
        st.signalCount = e.signalCount as number;
      }
    }
  }
  return Array.from(byKey.values());
};

export function PersistPanel() {
  useDevtoolsRender();
  const entries = collect();

  if (entries.length === 0) {
    return (
      <div style={s.empty}>
        No persisted signals.{' '}
        <span style={{ color: s.colors.textMuted }}>
          Import <code>react-refsignal/persist</code> and use{' '}
          <code>persist</code> / <code>usePersist</code>.
        </span>
      </div>
    );
  }

  return (
    <div>
      {entries.map((p) => (
        <div key={`${p.scope}:${p.key}`} style={s.card}>
          <div
            style={{
              ...s.cardTitle,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{p.key}</span>
            <span style={s.chip(s.colors.accentDim)}>{p.scope}</span>
          </div>
          <div style={s.cardRow}>
            <span style={s.cardLabel}>Hydrated</span>
            <span>
              {p.hydrated ? (
                <>
                  <span style={s.statusOk}>YES</span>
                  {p.hadStoredValue === false && (
                    <span
                      style={{
                        ...s.chip(s.colors.textMuted),
                        color: s.colors.bg,
                      }}
                    >
                      EMPTY
                    </span>
                  )}
                </>
              ) : (
                <span style={s.statusWarn}>PENDING</span>
              )}
            </span>
          </div>
          {p.hydrationMs !== undefined && (
            <div style={s.cardRow}>
              <span style={s.cardLabel}>Hydration time</span>
              <span>{p.hydrationMs.toFixed(1)}ms</span>
            </div>
          )}
          {p.signalCount !== undefined && (
            <div style={s.cardRow}>
              <span style={s.cardLabel}>Signals tracked</span>
              <span>{p.signalCount}</span>
            </div>
          )}
          <div style={s.cardRow}>
            <span style={s.cardLabel}>Writes</span>
            <span>{p.writeCount}</span>
          </div>
          <div style={s.cardRow}>
            <span style={s.cardLabel}>Last write</span>
            <span>{p.lastWriteAt ? ago(p.lastWriteAt) : '—'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
