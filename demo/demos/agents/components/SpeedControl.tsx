import { useRefSignalRender } from 'react-refsignal';
import { sliderLabel } from '../../../common/styles';
import { demo } from '../logic/state';
import { speedReadout } from '../styles/agents.styles';

export function SpeedControl() {
  const { tickSpeed } = demo.state();
  useRefSignalRender([tickSpeed]);
  return (
    <label style={sliderLabel}>
      Speed
      <input
        type="range"
        min={1}
        max={120}
        value={tickSpeed.current}
        onChange={(e) => {
          tickSpeed.update(+e.target.value);
        }}
        style={{ width: 100 }}
      />
      <span style={speedReadout}>{tickSpeed.current}/s</span>
    </label>
  );
}
