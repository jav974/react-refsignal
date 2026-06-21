// Small team-hue dot used in the leaderboard + killcam rows.
import { hueDot } from '../styles/agents.styles';

export function Dot({ hue }: { hue: number }) {
  return <span style={hueDot(hue)} />;
}
