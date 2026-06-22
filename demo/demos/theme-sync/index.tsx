// Persist + Broadcast composed on the same store. Open in two tabs to see
// live cross-tab sync; reload to see hydration from localStorage.

import {
  batch,
  createRefSignal,
  createRefSignalStore,
  useRefSignalStore,
  useRefSignalEffect,
  useRefSignalRender,
  type RefSignal,
} from 'react-refsignal';
import { broadcast, useBroadcast } from 'react-refsignal/broadcast';
import { persist } from 'react-refsignal/persist';
import { CodeChip } from '../../common/components/CodeChip';
import { Badge } from './components/Badge';
import { ColorField } from './components/ColorField';
import {
  badgeRow,
  broadcasterHeader,
  broadcasterSection,
  broadcastingBadge,
  fieldsRow,
  footerStyle,
  listeningBadge,
  pageStyle,
  presetBtn,
  presetRow,
  sectionLabel,
  statusInput,
} from './styles/theme-sync.styles';

// Order matters: broadcast wraps persist wraps the factory.
type ThemeStore = {
  bg: RefSignal<string>;
  fg: RefSignal<string>;
  accent: RefSignal<string>;
};

const themeStore = createRefSignalStore<ThemeStore>(
  broadcast<ThemeStore>(
    persist<ThemeStore>(
      () => ({
        bg: createRefSignal('#1a1a2e', 'theme.bg'),
        fg: createRefSignal('#e2e8f0', 'theme.fg'),
        accent: createRefSignal('#4a9eff', 'theme.accent'),
      }),
      { key: 'refsignal-theme-demo', version: 1 },
    ),
    { channel: 'refsignal-theme-demo' },
  ),
);

// One-to-many election demo. No store-level enhancers — `useBroadcast`
// attaches sync at the component so we can observe `isBroadcaster` in the UI.
type StatusStore = { message: RefSignal<string> };

const statusStore = createRefSignalStore<StatusStore>(() => ({
  message: createRefSignal('', 'theme.status.message'),
}));

const PRESETS: { name: string; bg: string; fg: string; accent: string }[] = [
  { name: 'Midnight', bg: '#1a1a2e', fg: '#e2e8f0', accent: '#4a9eff' },
  { name: 'Paper', bg: '#fafaf5', fg: '#1a1a1a', accent: '#d97706' },
  { name: 'Forest', bg: '#0f1f17', fg: '#d8e6d0', accent: '#6ee7b7' },
  { name: 'Solarized', bg: '#002b36', fg: '#eee8d5', accent: '#b58900' },
  { name: 'Rose', bg: '#2d1b2d', fg: '#fbcfe8', accent: '#f472b6' },
  { name: 'Highlighter', bg: '#fff9c4', fg: '#1a1a1a', accent: '#f97316' },
];

export default function ThemeSync() {
  // Unwrap = plain values + auto-generated setters (setBg, setFg, setAccent).
  const store = useRefSignalStore(themeStore, {
    renderOn: ['bg', 'fg', 'accent'],
    unwrap: true,
  });
  const { bg, fg, accent, setBg, setFg, setAccent } = store;

  // `isBroadcaster` is a signal; the UI re-renders on its transition.
  const { isBroadcaster } = useBroadcast(statusStore, {
    channel: 'refsignal-status',
    mode: 'one-to-many',
    heartbeatInterval: 100,
    heartbeatTimeout: 500,
  });
  useRefSignalRender([isBroadcaster]);

  const { message, setMessage } = useRefSignalStore(statusStore, {
    renderOn: ['message'],
    unwrap: true,
  });

  // Apply colors to <body> imperatively — no React in the paint path.
  useRefSignalEffect(() => {
    document.body.style.background = themeStore.bg.current;
    document.body.style.color = themeStore.fg.current;
  }, [themeStore.bg, themeStore.fg]);

  return (
    <div style={pageStyle}>
      <header>
        <h1 style={{ margin: 0, fontSize: 28, color: accent }}>
          refsignal theme sync
        </h1>
        <p style={{ marginTop: 8, opacity: 0.75, fontSize: 14, maxWidth: 680 }}>
          Colors are stored via <b style={{ color: accent }}>persist</b>{' '}
          (localStorage) and synced via{' '}
          <b style={{ color: accent }}>broadcast</b> (BroadcastChannel). Open
          this page in a second tab to see live sync — and reload either tab to
          see hydration from storage.
        </p>
      </header>

      <section style={fieldsRow}>
        <ColorField label="Background" value={bg} onChange={setBg} />
        <ColorField label="Text" value={fg} onChange={setFg} />
        <ColorField label="Accent" value={accent} onChange={setAccent} />
      </section>

      <section>
        <div style={sectionLabel}>Presets</div>
        <div style={presetRow}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                // batch() — without it, three partial snapshots fly across
                // tabs and echo-and-revert each other.
                batch(() => {
                  setBg(p.bg);
                  setFg(p.fg);
                  setAccent(p.accent);
                });
              }}
              style={presetBtn(p.bg, p.fg, p.accent)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section style={badgeRow}>
        <Badge>
          <b style={{ color: accent }}>Persisted</b> to localStorage
          <CodeChip>refsignal-theme-demo</CodeChip>
        </Badge>
        <Badge>
          <b style={{ color: accent }}>Synced</b> via BroadcastChannel
          <CodeChip>refsignal-theme-demo</CodeChip>
        </Badge>
      </section>

      <section style={broadcasterSection(accent)}>
        <div style={broadcasterHeader}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Broadcaster mode</h2>
          <CodeChip>mode: &apos;one-to-many&apos;</CodeChip>
          {isBroadcaster.current ? (
            <span style={broadcastingBadge(accent, bg)}>
              📣 This tab is broadcasting
            </span>
          ) : (
            <span style={listeningBadge}>👂 Listening — read-only</span>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 13, opacity: 0.7, maxWidth: 680 }}>
          Only one tab — the elected broadcaster — can send updates. Other tabs
          receive them read-only. Close the broadcasting tab and another takes
          over within the heartbeat interval (default: 2s + 5s timeout).
        </p>

        <input
          type="text"
          value={message}
          placeholder={
            isBroadcaster.current
              ? 'Type a status message — other tabs will see it live'
              : 'Only the broadcaster can edit — promote this tab by closing the broadcaster'
          }
          onChange={(e) => {
            setMessage(e.target.value);
          }}
          disabled={!isBroadcaster.current}
          style={statusInput(isBroadcaster.current, accent)}
        />
      </section>

      <footer style={footerStyle(accent)}>
        See <CodeChip>demo/demos/theme-sync/index.tsx</CodeChip> — the whole app
        is ~1 <CodeChip>createRefSignalStore</CodeChip> wrapped by{' '}
        <CodeChip>broadcast()</CodeChip> and <CodeChip>persist()</CodeChip>.
      </footer>
    </div>
  );
}
