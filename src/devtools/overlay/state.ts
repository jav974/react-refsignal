import type { WatchOptions } from '../../timing';
import { devtools } from '../adapter';

export type TabId =
  | 'signals'
  | 'timeline'
  | 'broadcast'
  | 'persist'
  | 'pulse'
  | 'cascade';

const HEIGHT_KEY = '__refsignal_devtools_height';
const COLLAPSED_KEY = '__refsignal_devtools_collapsed';
const TAB_KEY = '__refsignal_devtools_tab';
const RATE_KEY = '__refsignal_devtools_rate';

/**
 * Render-cadence presets. Each carries both a *mode* (frame / throttle /
 * debounce) and a value — exposed in the dock chrome so users can pick
 * the trade-off between liveness and host-page frame budget at runtime.
 *
 * - **frame**: re-render on every animation frame. Follows the display's
 *   native refresh rate (60 / 120 / 144Hz). Most expensive option.
 * - **throttle**: re-render at most once per N ms. Default mode — feels
 *   live without competing with the host page.
 * - **debounce**: only re-render once N ms have passed with no events.
 *   Useful for "wait until things settle" — e.g. tracing the final state
 *   of a cascade rather than every intermediate step.
 * - **debounce + maxWait**: same as debounce, but guarantees an update
 *   at most every `maxWait` ms even under continuous event traffic.
 *   Avoids the "starvation" case where a busy app never settles.
 */
export const RATE_PRESETS = [
  { id: 'frame', label: 'Per frame · live', options: { frame: true } },
  { id: '10hz', label: 'Throttle · 10Hz', options: { throttle: 100 } },
  { id: '4hz', label: 'Throttle · 4Hz', options: { throttle: 250 } },
  { id: '2hz', label: 'Throttle · 2Hz', options: { throttle: 500 } },
  { id: '1hz', label: 'Throttle · 1Hz', options: { throttle: 1000 } },
  {
    id: 'settle-200',
    label: 'On settle · 200ms',
    options: { debounce: 200 },
  },
  {
    id: 'settle-500',
    label: 'On settle · 500ms',
    options: { debounce: 500 },
  },
  {
    id: 'settle-200-max-1s',
    label: 'On settle · 200ms (max 1s)',
    options: { debounce: 200, maxWait: 1000 },
  },
  {
    id: 'settle-500-max-2s',
    label: 'On settle · 500ms (max 2s)',
    options: { debounce: 500, maxWait: 2000 },
  },
] as const satisfies readonly {
  id: string;
  label: string;
  options: WatchOptions;
}[];

export type RateId = (typeof RATE_PRESETS)[number]['id'];

const DEFAULT_RATE: RateId = '10hz';

const readHeight = (): number => {
  if (typeof localStorage === 'undefined') return 320;
  const raw = localStorage.getItem(HEIGHT_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 80 ? n : 320;
};

const readCollapsed = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === '1';
};

const readTab = (): TabId => {
  if (typeof localStorage === 'undefined') return 'signals';
  const raw = localStorage.getItem(TAB_KEY) as TabId | null;
  const allowed: TabId[] = [
    'signals',
    'timeline',
    'broadcast',
    'persist',
    'pulse',
    'cascade',
  ];
  return raw && allowed.includes(raw) ? raw : 'signals';
};

const readRate = (): RateId => {
  if (typeof localStorage === 'undefined') return DEFAULT_RATE;
  const raw = localStorage.getItem(RATE_KEY) as RateId | null;
  return raw && RATE_PRESETS.some((p) => p.id === raw) ? raw : DEFAULT_RATE;
};

export const dockHeight = devtools.createInternal(readHeight());
export const collapsed = devtools.createInternal(readCollapsed());
export const activeTab = devtools.createInternal<TabId>(readTab());
export const renderRate = devtools.createInternal<RateId>(readRate());

export const rateOptionsFor = (id: RateId): WatchOptions => {
  const preset = RATE_PRESETS.find((p) => p.id === id);
  return preset ? preset.options : { throttle: 100 };
};

if (typeof window !== 'undefined') {
  dockHeight.subscribe((h) => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(h));
    } catch {
      /* ignore */
    }
  });
  collapsed.subscribe((c) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, c ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
  activeTab.subscribe((t) => {
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  });
  renderRate.subscribe((r) => {
    try {
      localStorage.setItem(RATE_KEY, r);
    } catch {
      /* ignore */
    }
  });
}
