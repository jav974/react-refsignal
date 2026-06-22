// Heartbeat — pulse rate driven by mouse distance. Faster as the cursor nears,
// slower as it leaves. The rate is a derived signal; two modes consume it:
//
//   • Beat — the original. The pulse beats at the rate (updatePulse sets the
//     cadence); each tick replays a one-shot animation sized to the interval.
//     Discrete thumps with charm; a rate change only lands on the next beat.
//
//   • Breathe — one looping animation created once; its `playbackRate` is bent
//     from the rate signal in real time, so the circle breathes smoothly
//     faster/slower with no replay seam. The pulse still keeps cadence (drives
//     the bpm + the devtools pulse panel), it just no longer drives the visual.
//
// Same rate, two independent consumers — and no setInterval/useEffect timers.
// The component never re-renders after mount (except the mode toggle); the
// rate-dependent bpm view lives in <BpmReadout>, which subscribes itself.

import { useEffect, useRef, useState } from 'react';
import {
  usePulseRefSignal,
  useRefSignalEffect,
  useRefSignalMemo,
} from 'react-refsignal';
import { CodeChip } from '../../common/components/CodeChip';
import { useTrackPointer } from '../../common/hooks/useTrackPointer';
import { BpmReadout } from './components/BpmReadout';
import {
  circleStyle,
  hintStyle,
  infoBlock,
  legendStyle,
  modeBtn,
  modeToggle,
  pageStyle,
} from './styles/heartbeat.styles';

const MIN_MS = 200;
const MAX_MS = 2000;
const FAR_PX = 600;

// Breathe-mode reference duration. One loop at playbackRate 1 takes this long;
// we set playbackRate = BASE / rate so the effective period equals the current
// rate — i.e. the breath stays in sync with the pulse cadence.
const BREATHE_BASE_MS = 1000;

// Beat: a quick pop sized to fill the interval. Breathe: a gentle symmetric
// swell that loops forever, retimed via playbackRate.
const BEAT_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1) translateY(0)' },
  { transform: 'scale(1.35) translateY(-10px)', offset: 0.2 },
  { transform: 'scale(1) translateY(0)' },
];
const BREATHE_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1) translateY(0)' },
  { transform: 'scale(1.22) translateY(-6px)', offset: 0.5 },
  { transform: 'scale(1) translateY(0)' },
];

type Mode = 'beat' | 'breathe';

// Distance → ms interval. Linear ramp clamped to [MIN_MS, MAX_MS]. PulseRate
// accepts `number` directly, so no template-literal cast needed.
function rateFromDistance(d: number): number {
  const t = Math.min(1, d / FAR_PX);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

export default function Heartbeat() {
  const [mode, setMode] = useState<Mode>('beat');

  // Cursor → mouse signal (window pointermove), owned by the hook.
  const mouse = useTrackPointer({ name: 'heartbeat.mouse' });
  const circleRef = useRef<HTMLDivElement>(null);
  const center = useRef({ x: 0, y: 0 });
  // The persistent breathe-mode animation (null in beat mode).
  const breatheRef = useRef<Animation | null>(null);

  // Initial cadence is the resting rate; updatePulse below wires it to the
  // computed `heartRate` so cadence becomes reactive data.
  const heart = usePulseRefSignal(MAX_MS, 'heartbeat.pulse');

  // Derived rate: mouse-to-circle distance → ms interval.
  const heartRate = useRefSignalMemo(() => {
    const dx = mouse.current.x - center.current.x;
    const dy = mouse.current.y - center.current.y;
    return rateFromDistance(Math.hypot(dx, dy));
  }, [mouse]);

  // Pulse cadence — alive in both modes. Each tick re-arms at the current rate
  // so the beat tracks the cursor. In beat mode it also fires a one-shot
  // animation sized to the interval (the original behavior, where the animation
  // duration matches updatePulse so it ends exactly as the next tick fires). In
  // breathe mode the pulse just keeps time.
  useRefSignalEffect(() => {
    if (mode === 'beat') {
      circleRef.current?.animate(BEAT_KEYFRAMES, {
        duration: heartRate.current,
        easing: 'ease-out',
      });
    }
    heart.updatePulse(heartRate.current);
  }, [heart, mode]);

  // Breathe mode: create one looping animation while the mode is active.
  // Cancelling sibling animations first avoids a leftover one-shot beat
  // fighting the loop for the transform; the cleanup cancels the loop so a
  // switch back to beat returns the circle to rest.
  useEffect(() => {
    if (mode !== 'breathe') return;
    const el = circleRef.current;
    if (!el) return;
    el.getAnimations().forEach((a) => {
      a.cancel();
    });
    const anim = el.animate(BREATHE_KEYFRAMES, {
      duration: BREATHE_BASE_MS,
      iterations: Infinity,
      easing: 'ease-in-out',
    });
    anim.updatePlaybackRate(BREATHE_BASE_MS / heartRate.current);
    breatheRef.current = anim;
    return () => {
      anim.cancel();
      breatheRef.current = null;
    };
  }, [mode, heartRate]);

  // Bend the loop's speed from the rate in real time — the smooth part. Runs
  // only in breathe mode; `frame: true` coalesces the mousemove fan-out.
  useRefSignalEffect(
    () => {
      if (mode !== 'breathe') return;
      breatheRef.current?.updatePlaybackRate(
        BREATHE_BASE_MS / heartRate.current,
      );
    },
    [heartRate, mode],
    { frame: true },
  );

  // Measure circle center on mount + resize.
  useEffect(() => {
    const measure = () => {
      const el = circleRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div style={pageStyle}>
      <div style={modeToggle}>
        <button
          style={modeBtn(mode === 'beat')}
          onClick={() => {
            setMode('beat');
          }}
        >
          Beat
        </button>
        <button
          style={modeBtn(mode === 'breathe')}
          onClick={() => {
            setMode('breathe');
          }}
        >
          Breathe
        </button>
      </div>

      <div ref={circleRef} style={circleStyle} />

      <div style={infoBlock}>
        <BpmReadout rate={heartRate} />
        <div style={hintStyle}>
          Move closer to make the heart race; further away to calm it down.
        </div>
      </div>

      <div style={legendStyle}>
        {mode === 'beat' ? (
          <>
            <b>Beat</b> — each pulse tick replays a one-shot animation and
            re-arms <CodeChip>heart.updatePulse(heartRate.current)</CodeChip>.
            Discrete thumps; a rate change lands on the next beat. Charm.
          </>
        ) : (
          <>
            <b>Breathe</b> — one looping animation, its{' '}
            <CodeChip>playbackRate</CodeChip> bent from the rate in real time,
            so it retimes with no replay seam. The pulse still keeps cadence.
            Correctness.
          </>
        )}
      </div>
    </div>
  );
}
