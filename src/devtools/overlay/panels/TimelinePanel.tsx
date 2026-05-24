import { useState } from 'react';
import { devtools } from '../../adapter';
import { ago, formatValue } from '../format';
import * as s from '../styles';
import { useDevtoolsRender } from '../useDevtoolsRender';

interface UpdateEvent {
  kind: 'signal:update';
  id: string;
  oldValue: unknown;
  newValue: unknown;
  triggeredBy?: string;
  t: number;
  [extra: string]: unknown;
}

interface TouchEvent {
  kind: 'signal:touch';
  id: string;
  value: unknown;
  t: number;
  [extra: string]: unknown;
}

type TimelineEvent = UpdateEvent | TouchEvent;

export function TimelinePanel() {
  useDevtoolsRender();
  const [filter, setFilter] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const all = devtools
    .getEvents()
    .filter(
      (e): e is TimelineEvent =>
        e.kind === 'signal:update' || e.kind === 'signal:touch',
    );
  const filtered = filter
    ? all.filter((u) =>
        u.id.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : all;

  if (all.length === 0) {
    return <div style={s.empty}>No updates yet.</div>;
  }

  const ordered = [...filtered].reverse();

  return (
    <div>
      <input
        style={s.filterInput}
        placeholder="filter by signal name…"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
      />
      <div>
        {ordered.map((u, idx) => {
          const key = `${String(u.t)}-${String(idx)}`;
          const expanded = expandedKey === key;
          const isTouch = u.kind === 'signal:touch';
          return (
            <div
              key={key}
              style={{
                borderBottom: `1px solid ${s.colors.border}`,
                padding: '4px 4px',
                cursor: 'pointer',
              }}
              onClick={() => {
                setExpandedKey(expanded ? null : key);
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    color: s.colors.textMuted,
                    fontSize: 10,
                    width: 48,
                  }}
                >
                  {ago(u.t, { compact: true })}
                </span>
                <span style={{ color: s.colors.accent, minWidth: 100 }}>
                  {u.id}
                </span>
                {!isTouch && u.triggeredBy && (
                  <span
                    style={{
                      ...s.chip(s.colors.trace),
                      color: s.colors.bg,
                    }}
                    title={`triggered by effect ${u.triggeredBy}`}
                  >
                    ⤳ {u.triggeredBy}
                  </span>
                )}
                {isTouch ? (
                  <>
                    <span
                      style={{
                        ...s.chip(s.colors.textMuted),
                        color: s.colors.bg,
                      }}
                      title="notify() — direct .current mutation, throttled to 10Hz/signal"
                    >
                      touch
                    </span>
                    <span style={{ ...s.diffNew, fontSize: 11 }}>
                      {formatValue(u.value)}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ ...s.diffOld, fontSize: 11 }}>
                      {formatValue(u.oldValue)}
                    </span>
                    <span style={{ color: s.colors.textMuted }}>→</span>
                    <span style={{ ...s.diffNew, fontSize: 11 }}>
                      {formatValue(u.newValue)}
                    </span>
                  </>
                )}
              </div>
              {expanded && (
                <pre
                  style={{
                    background: s.colors.bg,
                    padding: 6,
                    fontSize: 11,
                    margin: '4px 0 0 56px',
                    borderRadius: 3,
                    color: s.colors.text,
                  }}
                >
                  {(() => {
                    try {
                      if (isTouch) {
                        return `value: ${JSON.stringify(u.value, null, 2)}`;
                      }
                      return `from: ${JSON.stringify(u.oldValue, null, 2)}\nto:   ${JSON.stringify(u.newValue, null, 2)}`;
                    } catch {
                      return isTouch
                        ? `value: ${String(u.value)}`
                        : `from: ${String(u.oldValue)}\nto:   ${String(u.newValue)}`;
                    }
                  })()}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
