import { useRefSignalRender } from 'react-refsignal';
import { demo } from '../logic/state';
import { Dot } from './Dot';
import {
  emptyFeed,
  feedPanelStyle,
  killRow,
  panelHeading,
} from '../styles/agents.styles';

export function Killcam() {
  const { killFeed } = demo.state();
  useRefSignalRender([killFeed]);
  const events = killFeed.current;

  return (
    <div style={feedPanelStyle}>
      <div style={panelHeading}>FEED</div>
      {events.length === 0 ? (
        <div style={emptyFeed}>No casualties yet</div>
      ) : (
        events.map((e, i) => (
          <div key={`${e.killerId}-${i}-${e.victimName}`} style={killRow}>
            <Dot hue={e.killerHue} />
            <span style={{ fontSize: 11 }}>{e.killerName}</span>
            <span style={{ opacity: 0.4, fontSize: 10 }}>ate</span>
            <Dot hue={e.victimHue} />
            <span style={{ fontSize: 11, opacity: 0.7 }}>{e.victimName}</span>
          </div>
        ))
      )}
    </div>
  );
}
