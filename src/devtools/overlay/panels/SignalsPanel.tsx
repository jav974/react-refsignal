import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { listenersMap } from '../../../refsignal';
import { devtools, type SignalEntry } from '../../adapter';
import { formatValue, typeOf } from '../format';
import * as s from '../styles';
import { useDevtoolsRender } from '../useDevtoolsRender';

type SortKey = 'name' | 'updated' | 'subs';
type SortDir = 'asc' | 'desc';

/** Cap on rendered rows. Apps can register thousands of signals (the agents
 * demo creates ~4000); rendering them all costs ~5 DOM nodes per row × every
 * panel re-render. With the default `updated desc` sort, the cap shows the
 * most-active signals — the ones you'd care about — and the filter input
 * handles drilling into the rest. */
const RENDER_CAP = 200;

const subscriberCount = (entry: SignalEntry): number =>
  listenersMap.get(entry.signal as object)?.size ?? 0;

function renderRow(
  entry: SignalEntry,
  selectedId: string | null,
  setSelectedId: (id: string) => void,
  inGroup: boolean,
): ReactElement {
  return (
    <tr
      key={entry.id}
      onClick={() => {
        setSelectedId(entry.id);
      }}
      style={{
        cursor: 'pointer',
        background: entry.id === selectedId ? s.colors.bgAlt : undefined,
      }}
    >
      <td style={{ ...s.td, paddingLeft: inGroup ? 16 : undefined }}>
        {inGroup && entry.store !== undefined
          ? entry.id.startsWith(`${entry.store}.`)
            ? entry.id.slice(entry.store.length + 1)
            : entry.id
          : entry.id}
        {!entry.name && (
          <span
            style={{
              color: s.colors.textMuted,
              marginLeft: 4,
              fontSize: 10,
            }}
          >
            (anon)
          </span>
        )}
      </td>
      <td style={{ ...s.td, color: s.colors.textMuted }}>
        {typeOf(entry.signal.current)}
      </td>
      <td style={s.tdMono}>{formatValue(entry.signal.current)}</td>
      <td style={s.td}>{subscriberCount(entry)}</td>
      <td style={{ ...s.td, color: s.colors.textMuted }}>
        {entry.signal.lastUpdated}
      </td>
    </tr>
  );
}

export function SignalsPanel() {
  useDevtoolsRender();
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [collapsedStores, setCollapsedStores] = useState<Set<string>>(
    () => new Set(),
  );

  const rows = devtools.getAllSignals();
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const items = f
      ? rows.filter(
          (r) =>
            r.id.toLowerCase().includes(f) ||
            (r.name?.toLowerCase().includes(f) ?? false) ||
            (r.store?.toLowerCase().includes(f) ?? false),
        )
      : rows.slice();
    items.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.id.localeCompare(b.id);
      else if (sortKey === 'updated')
        cmp = a.signal.lastUpdated - b.signal.lastUpdated;
      else cmp = subscriberCount(a) - subscriberCount(b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [rows, filter, sortKey, sortDir]);

  const onSort = (k: SortKey): void => {
    if (sortKey === k) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  };

  const visible = filtered.slice(0, RENDER_CAP);
  const truncated = filtered.length > RENDER_CAP;

  // Partition the visible rows into store groups (ordered by store name) and
  // loose signals. The sort applies *within* each section.
  const { storeGroups, loose } = useMemo(() => {
    const byStore = new Map<string, SignalEntry[]>();
    const rest: SignalEntry[] = [];
    for (const e of visible) {
      if (e.store !== undefined) {
        const arr = byStore.get(e.store) ?? [];
        arr.push(e);
        byStore.set(e.store, arr);
      } else {
        rest.push(e);
      }
    }
    const groups = Array.from(byStore.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return { storeGroups: groups, loose: rest };
  }, [visible]);

  const toggleStore = (storeName: string): void => {
    setCollapsedStores((prev) => {
      const next = new Set(prev);
      if (next.has(storeName)) next.delete(storeName);
      else next.add(storeName);
      return next;
    });
  };

  const selected = selectedId
    ? (filtered.find((r) => r.id === selectedId) ??
      rows.find((r) => r.id === selectedId))
    : null;

  if (rows.length === 0) {
    return <div style={s.empty}>No signals registered yet.</div>;
  }

  const arrow = (k: SortKey): string =>
    sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div style={{ display: 'flex', gap: 8, height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          style={s.filterInput}
          placeholder="filter by name…"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
        <div
          style={{
            color: s.colors.textMuted,
            fontSize: 10,
            marginBottom: 4,
          }}
        >
          {truncated ? (
            <>
              Showing top <b>{RENDER_CAP}</b> of{' '}
              <b>{filtered.length.toString()}</b>
              {filter ? ' matching' : ''} signals
              {!filter && ' — filter or sort to narrow'}
            </>
          ) : (
            <>
              {filtered.length.toString()} signal
              {filtered.length === 1 ? '' : 's'}
              {filter ? ' matching' : ''}
            </>
          )}
        </div>
        <table style={s.table}>
          <thead>
            <tr>
              <th
                style={s.th}
                onClick={() => {
                  onSort('name');
                }}
              >
                Name{arrow('name')}
              </th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Value</th>
              <th
                style={s.th}
                onClick={() => {
                  onSort('subs');
                }}
              >
                Subs{arrow('subs')}
              </th>
              <th
                style={s.th}
                onClick={() => {
                  onSort('updated');
                }}
              >
                #upd{arrow('updated')}
              </th>
            </tr>
          </thead>
          <tbody>
            {storeGroups.map(([storeName, members]) => {
              const isCollapsed = collapsedStores.has(storeName);
              return (
                <Fragment key={`store:${storeName}`}>
                  <tr
                    onClick={() => {
                      toggleStore(storeName);
                    }}
                    style={{ cursor: 'pointer' }}
                    data-testid={`store-group-${storeName}`}
                  >
                    <td
                      colSpan={5}
                      style={{
                        ...s.td,
                        background: s.colors.bgAlt,
                        fontWeight: 600,
                      }}
                    >
                      {isCollapsed ? '▸' : '▾'} {storeName}
                      <span
                        style={{
                          color: s.colors.textMuted,
                          marginLeft: 4,
                          fontSize: 10,
                          fontWeight: 400,
                        }}
                      >
                        ({members.length} signal
                        {members.length === 1 ? '' : 's'})
                      </span>
                    </td>
                  </tr>
                  {!isCollapsed &&
                    members.map((entry) =>
                      renderRow(entry, selectedId, setSelectedId, true),
                    )}
                </Fragment>
              );
            })}
            {loose.map((entry) =>
              renderRow(entry, selectedId, setSelectedId, false),
            )}
          </tbody>
        </table>
      </div>
      {selected && (
        <div style={{ ...s.card, width: 320, alignSelf: 'flex-start' }}>
          <div style={s.cardTitle}>{selected.id}</div>
          {selected.store !== undefined && (
            <div style={s.cardRow}>
              <span style={s.cardLabel}>Store</span>
              <span>{selected.store}</span>
            </div>
          )}
          <div style={s.cardRow}>
            <span style={s.cardLabel}>Type</span>
            <span>{typeOf(selected.signal.current)}</span>
          </div>
          <div style={s.cardRow}>
            <span style={s.cardLabel}>Subscribers</span>
            <span>{subscriberCount(selected)}</span>
          </div>
          <div style={s.cardRow}>
            <span style={s.cardLabel}>Last updated</span>
            <span>{selected.signal.lastUpdated}</span>
          </div>
          <pre
            style={{
              background: s.colors.bg,
              color: s.colors.accent,
              padding: 6,
              fontSize: 11,
              maxHeight: 200,
              overflow: 'auto',
              borderRadius: 3,
              margin: '6px 0 0',
            }}
          >
            {(() => {
              try {
                return JSON.stringify(selected.signal.current, null, 2);
              } catch {
                return String(selected.signal.current);
              }
            })()}
          </pre>
          <button
            style={{
              ...s.iconBtn,
              marginTop: 4,
              border: `1px solid ${s.colors.border}`,
              borderRadius: 3,
              padding: '2px 6px',
            }}
            onClick={() => {
              try {
                void navigator.clipboard.writeText(
                  JSON.stringify(selected.signal.current),
                );
              } catch {
                /* ignore */
              }
            }}
          >
            Copy value
          </button>
        </div>
      )}
    </div>
  );
}
