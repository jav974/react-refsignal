import { devtools, type BroadcastChannelState } from '../../adapter';
import { ago } from '../format';
import * as s from '../styles';
import { useDevtoolsRender } from '../useDevtoolsRender';

const peerAge = (lastSeen: number): string => {
  const ms = Math.max(0, Date.now() - lastSeen);
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const peerHealth = (lastSeen: number, timeout?: number): keyof typeof s => {
  if (!timeout) return 'statusOk';
  const age = Date.now() - lastSeen;
  if (age > timeout * 0.66) return 'statusError';
  if (age > timeout * 0.33) return 'statusWarn';
  return 'statusOk';
};

const broadcasterChip = (ch: BroadcastChannelState) =>
  ch.isBroadcaster
    ? { label: 'isBroadcaster: true', style: s.statusOk }
    : { label: 'isBroadcaster: false', style: s.chip(s.colors.textMuted) };

const stableChip = (ch: BroadcastChannelState) =>
  ch.isStable
    ? { label: 'isStableBroadcaster: true', style: s.statusOk }
    : { label: 'isStableBroadcaster: false', style: s.statusWarn };

export function BroadcastPanel() {
  useDevtoolsRender();
  const channels = devtools.getBroadcastChannels();

  if (channels.length === 0) {
    return (
      <div style={s.empty}>
        No broadcast channels active.{' '}
        <span style={{ color: s.colors.textMuted }}>
          Import <code>react-refsignal/broadcast</code> and use{' '}
          <code>broadcast</code> / <code>useBroadcast</code> to enable cross-tab
          sync.
        </span>
      </div>
    );
  }

  return (
    <div>
      {channels.map((ch) => {
        const broadcaster = broadcasterChip(ch);
        const stable = stableChip(ch);
        const isOneToMany = ch.mode === 'one-to-many';
        return (
          <div key={ch.channel} style={s.card}>
            <div
              style={{
                ...s.cardTitle,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span>{ch.channel}</span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span style={broadcaster.style}>{broadcaster.label}</span>
                {/* `isStableBroadcaster` only differs from `isBroadcaster`
                    when there's an election (one-to-many). Many-to-many is
                    always stable, so showing both chips would be redundant
                    noise. */}
                {isOneToMany && (
                  <span style={stable.style}>{stable.label}</span>
                )}
              </span>
            </div>
            {ch.mode && (
              <div style={s.cardRow}>
                <span style={s.cardLabel}>Mode</span>
                <span>
                  <code style={{ color: s.colors.accent }}>{ch.mode}</code>
                </span>
              </div>
            )}
            {ch.heartbeatInterval !== undefined && (
              <div style={s.cardRow}>
                <span style={s.cardLabel}>Heartbeat</span>
                <span>
                  every <b>{ch.heartbeatInterval}ms</b>, timeout{' '}
                  <b>{ch.heartbeatTimeout}ms</b>
                </span>
              </div>
            )}
            {ch.gracePeriod !== undefined && ch.gracePeriod > 0 && (
              <div style={s.cardRow}>
                <span style={s.cardLabel}>Grace period</span>
                <span>{ch.gracePeriod}ms</span>
              </div>
            )}
            <div style={s.cardRow}>
              <span style={s.cardLabel}>Peers</span>
              <span>{ch.peerCount}</span>
            </div>
            <div style={s.cardRow}>
              <span style={s.cardLabel}>Last channel update</span>
              <span>{ago(ch.lastUpdatedAt)}</span>
            </div>
            {ch.peers.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 4,
                  borderTop: `1px solid ${s.colors.border}`,
                }}
              >
                <div
                  style={{
                    color: s.colors.textMuted,
                    fontSize: 10,
                    marginBottom: 4,
                  }}
                >
                  Peers (id · last seen)
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
                >
                  {ch.peers
                    .slice()
                    .sort((a, b) => b.lastSeen - a.lastSeen)
                    .map((p) => {
                      const healthKey = peerHealth(
                        p.lastSeen,
                        ch.heartbeatTimeout,
                      );
                      const healthStyle = s[healthKey] as React.CSSProperties;
                      return (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 11,
                          }}
                        >
                          <span
                            style={{
                              ...s.chip(s.colors.accentDim),
                              color: s.colors.text,
                            }}
                          >
                            {p.id}
                          </span>
                          <span style={{ color: s.colors.textMuted }}>
                            {peerAge(p.lastSeen)}
                          </span>
                          <span style={healthStyle}>●</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
