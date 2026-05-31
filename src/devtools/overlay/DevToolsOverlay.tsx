import { useEffect, useRef, useState } from 'react';
import { useRefSignalRender } from '../../hooks/useRefSignalRender';
import * as s from './styles';
import {
  activeTab,
  collapsed,
  dockHeight,
  RATE_PRESETS,
  renderRate,
  type RateId,
  type TabId,
} from './state';
import { BroadcastPanel } from './panels/BroadcastPanel';
import { CascadePanel } from './panels/CascadePanel';
import { PersistPanel } from './panels/PersistPanel';
import { PulsePanel } from './panels/PulsePanel';
import { SignalsPanel } from './panels/SignalsPanel';
import { TimelinePanel } from './panels/TimelinePanel';

const TABS: { id: TabId; label: string }[] = [
  { id: 'signals', label: 'Signals' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'cascade', label: 'Cascade' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'persist', label: 'Persist' },
  { id: 'pulse', label: 'Pulse' },
];

const MIN_HEIGHT = 120;
const COLLAPSED_HEIGHT = 32;
/**
 * Host pages can reserve space for the dock using this CSS custom property —
 * it tracks the dock's effective height (collapsed/expanded/resized) so any
 * fixed-position UI in the host page can position itself with e.g.
 * `bottom: calc(var(--refsignal-devtools-height, 0px) + 12px)`. The variable
 * is removed when the overlay unmounts so production / no-devtools builds get
 * the natural `0px` fallback.
 */
const CSS_HEIGHT_VAR = '--refsignal-devtools-height';

export function DevToolsOverlay() {
  useRefSignalRender([dockHeight, collapsed, activeTab, renderRate]);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return;
      const next = window.innerHeight - e.clientY;
      const max = window.innerHeight - 40;
      dockHeight.update(Math.max(MIN_HEIGHT, Math.min(max, next)));
    };
    const onUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Publish effective dock height as a CSS variable so the host page can
  // position fixed UI above the dock. Re-runs on resize/collapse via the
  // useRefSignalRender subscription above.
  const effectiveHeight = collapsed.current
    ? COLLAPSED_HEIGHT
    : dockHeight.current;
  useEffect(() => {
    document.documentElement.style.setProperty(
      CSS_HEIGHT_VAR,
      `${String(effectiveHeight)}px`,
    );
    return () => {
      document.documentElement.style.removeProperty(CSS_HEIGHT_VAR);
    };
  }, [effectiveHeight]);

  const startDrag = (): void => {
    draggingRef.current = true;
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
  };

  const isCollapsed = collapsed.current;
  const renderPanel = () => {
    switch (activeTab.current) {
      case 'signals':
        return <SignalsPanel />;
      case 'timeline':
        return <TimelinePanel />;
      case 'broadcast':
        return <BroadcastPanel />;
      case 'persist':
        return <PersistPanel />;
      case 'pulse':
        return <PulsePanel />;
      case 'cascade':
        return <CascadePanel />;
    }
  };

  return (
    <div
      style={s.dock(
        isCollapsed ? COLLAPSED_HEIGHT : dockHeight.current,
        isCollapsed,
      )}
      data-testid="refsignal-devtools"
    >
      <div
        style={dragging ? s.dragHandleActive : s.dragHandle}
        onMouseDown={startDrag}
        data-testid="refsignal-devtools-drag"
      />
      <div style={s.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            style={s.tab(activeTab.current === t.id && !isCollapsed)}
            onClick={() => {
              if (isCollapsed) collapsed.update(false);
              activeTab.update(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={s.spacer} />
        {!isCollapsed && (
          <select
            value={renderRate.current}
            onChange={(e) => {
              renderRate.update(e.target.value as RateId);
            }}
            style={s.rateSelect}
            title="Overlay refresh rate"
            data-testid="refsignal-devtools-rate"
          >
            {RATE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <button
          style={s.iconBtn}
          onClick={() => {
            collapsed.update(!isCollapsed);
          }}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          data-testid="refsignal-devtools-toggle"
        >
          {isCollapsed ? '▲' : '▼'}
        </button>
      </div>
      {!isCollapsed && <div style={s.content}>{renderPanel()}</div>}
    </div>
  );
}
