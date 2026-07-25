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

/**
 * Internal signal with localStorage write-through. `parse` validates the
 * stored raw string and returns undefined to fall back to the default.
 */
const persistedInternal = <T>(
  key: string,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string,
  fallback: T,
) => {
  let initial = fallback;
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(key);
    if (raw !== null) initial = parse(raw) ?? fallback;
  }
  const signal = devtools.createInternal(initial);
  if (typeof window !== 'undefined') {
    signal.subscribe((value) => {
      try {
        localStorage.setItem(key, serialize(value));
      } catch {
        /* ignore */
      }
    });
  }
  return signal;
};

const TABS: readonly TabId[] = [
  'signals',
  'timeline',
  'broadcast',
  'persist',
  'pulse',
  'cascade',
];

export const dockHeight = persistedInternal(
  HEIGHT_KEY,
  (raw) => {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 80 ? n : undefined;
  },
  String,
  320,
);
export const collapsed = persistedInternal(
  COLLAPSED_KEY,
  (raw) => raw === '1',
  (c) => (c ? '1' : '0'),
  false,
);
export const activeTab = persistedInternal(
  TAB_KEY,
  (raw) => (TABS.includes(raw as TabId) ? (raw as TabId) : undefined),
  (t) => t,
  'signals',
);
export const renderRate = persistedInternal<RateId>(
  RATE_KEY,
  (raw) =>
    RATE_PRESETS.some((p) => p.id === raw) ? (raw as RateId) : undefined,
  (r) => r,
  DEFAULT_RATE,
);

export const rateOptionsFor = (id: RateId): WatchOptions => {
  const preset = RATE_PRESETS.find((p) => p.id === id);
  return preset ? preset.options : { throttle: 100 };
};
