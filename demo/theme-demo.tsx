// demo/theme-demo.tsx
//
// Persist + Broadcast composed on the same store.
//
// Try it:
//   - Pick colors. They're saved to localStorage (persist).
//   - Open the same URL in a second tab. Same colors apply — cross-tab sync
//     via BroadcastChannel (broadcast).
//   - Change colors in either tab. The other updates live.
//   - Reload any tab. Colors restored from localStorage.

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

// ---------------------------------------------------------------
// Store — factory wrapped by persist and broadcast.
// Order matters: `broadcast` wraps `persist` wraps the factory.
// ---------------------------------------------------------------

type ThemeStore = {
  bg: RefSignal<string>;
  fg: RefSignal<string>;
  accent: RefSignal<string>;
};

const themeStore = createRefSignalStore<ThemeStore>(
  broadcast<ThemeStore>(
    persist<ThemeStore>(
      () => ({
        bg: createRefSignal('#1a1a2e'),
        fg: createRefSignal('#e2e8f0'),
        accent: createRefSignal('#4a9eff'),
      }),
      { key: 'refsignal-theme-demo', version: 1 },
    ),
    { channel: 'refsignal-theme-demo' },
  ),
);

// ---------------------------------------------------------------
// Broadcaster-mode store — one-to-many election demo.
// This store has NO persist and NO outer broadcast wrapper — the
// `useBroadcast` hook attaches cross-tab sync at the component level
// so we can observe the `isBroadcaster` signal in the UI.
// ---------------------------------------------------------------

type StatusStore = { message: RefSignal<string> };

const statusStore = createRefSignalStore<StatusStore>(() => ({
  message: createRefSignal(''),
}));

// ---------------------------------------------------------------
// Presets
// ---------------------------------------------------------------

const PRESETS: { name: string; bg: string; fg: string; accent: string }[] = [
  { name: 'Midnight', bg: '#1a1a2e', fg: '#e2e8f0', accent: '#4a9eff' },
  { name: 'Paper',    bg: '#fafaf5', fg: '#1a1a1a', accent: '#d97706' },
  { name: 'Forest',   bg: '#0f1f17', fg: '#d8e6d0', accent: '#6ee7b7' },
  { name: 'Solarized',bg: '#002b36', fg: '#eee8d5', accent: '#b58900' },
  { name: 'Rose',     bg: '#2d1b2d', fg: '#fbcfe8', accent: '#f472b6' },
  { name: 'Highlighter', bg: '#fff9c4', fg: '#1a1a1a', accent: '#f97316' },
];

// ---------------------------------------------------------------
// UI
// ---------------------------------------------------------------

export default function ThemeDemo() {
  // Re-render when any of the three signals change. Unwrap for plain-value
  // reads + auto-generated setters (setBg, setFg, setAccent).
  const store = useRefSignalStore(themeStore, {
    renderOn: ['bg', 'fg', 'accent'],
    unwrap: true,
  });
  const { bg, fg, accent, setBg, setFg, setAccent } = store;

  // One-to-many broadcaster election for the status message.
  // `isBroadcaster` is a signal — the UI re-renders on its transition.
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

  // Apply colors to <body> imperatively — no React in the "paint" path.
  // The effect re-runs on any of the three signals firing.
  useRefSignalEffect(() => {
    document.body.style.background = themeStore.bg.current;
    document.body.style.color = themeStore.fg.current;
  }, [themeStore.bg, themeStore.fg]);

  return (
    <div style={{
      minHeight: '100vh',
      padding: '40px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 28, color: accent }}>
          refsignal theme sync
        </h1>
        <p style={{ marginTop: 8, opacity: 0.75, fontSize: 14, maxWidth: 680 }}>
          Colors are stored via <b style={{ color: accent }}>persist</b> (localStorage)
          and synced via <b style={{ color: accent }}>broadcast</b> (BroadcastChannel).
          Open this page in a second tab to see live sync — and reload either tab
          to see hydration from storage.
        </p>
      </header>

      <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <ColorField label="Background" value={bg} onChange={setBg} />
        <ColorField label="Text"       value={fg} onChange={setFg} />
        <ColorField label="Accent"     value={accent} onChange={setAccent} />
      </section>

      <section>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>Presets</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                // batch() coalesces the three signal updates into one
                // notification burst. Without it, each .update() would fire
                // broadcast separately — three partial snapshots flying
                // across tabs would echo-and-revert each other because the
                // second tab's echoes arrive after local state has moved on.
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

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Badge>
          <b style={{ color: accent }}>Persisted</b> to localStorage
          <code style={codeStyle}>refsignal-theme-demo</code>
        </Badge>
        <Badge>
          <b style={{ color: accent }}>Synced</b> via BroadcastChannel
          <code style={codeStyle}>refsignal-theme-demo</code>
        </Badge>
      </section>

      <section style={{
        marginTop: 12,
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${accent}44`,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Broadcaster mode</h2>
          <code style={codeStyle}>mode: &apos;one-to-many&apos;</code>
          {isBroadcaster.current ? (
            <span style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: accent,
              color: bg,
              fontSize: 12,
              fontWeight: 700,
            }}>
              📣 This tab is broadcasting
            </span>
          ) : (
            <span style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.08)',
              fontSize: 12,
              fontWeight: 700,
              opacity: 0.7,
            }}>
              👂 Listening — read-only
            </span>
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
          onChange={(e) => setMessage(e.target.value)}
          disabled={!isBroadcaster.current}
          style={{
            padding: '10px 14px',
            fontSize: 14,
            border: `1px solid ${isBroadcaster.current ? accent : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 6,
            background: 'transparent',
            color: 'inherit',
            opacity: isBroadcaster.current ? 1 : 0.6,
            cursor: isBroadcaster.current ? 'text' : 'not-allowed',
          }}
        />
      </section>

      <footer style={{
        marginTop: 'auto',
        fontSize: 12,
        opacity: 0.5,
        borderTop: `1px solid ${accent}33`,
        paddingTop: 12,
      }}>
        See <code style={codeStyle}>demo/theme-demo.tsx</code> — the whole app is
        ~1 <code style={codeStyle}>createRefSignalStore</code> wrapped by{' '}
        <code style={codeStyle}>broadcast()</code> and{' '}
        <code style={codeStyle}>persist()</code>.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, opacity: 0.6 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 42, height: 32, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '6px 10px',
            fontFamily: 'monospace',
            fontSize: 13,
            border: '1px solid currentColor',
            borderRadius: 4,
            background: 'transparent',
            color: 'inherit',
            width: 100,
          }}
        />
      </span>
    </label>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '8px 14px',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.1)',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      {children}
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 12,
  background: 'rgba(255,255,255,0.1)',
};

function presetBtn(bg: string, fg: string, accent: string): React.CSSProperties {
  return {
    padding: '10px 16px',
    border: `2px solid ${accent}`,
    borderRadius: 6,
    background: bg,
    color: fg,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    transition: 'transform 100ms',
  };
}
