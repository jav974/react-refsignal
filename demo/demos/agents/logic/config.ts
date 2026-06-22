// Simulation tuning + team/identity tables. Pure data — no signals, no React.

export const COUNTS = [60, 120, 180, 240, 360] as const;
export const DEFAULT_COUNT = 120;

export const TEAM_HUES = [10, 50, 140, 220];
export const TEAM_NAMES = ['Crimson', 'Solar', 'Forest', 'Tide'];
export const N_TEAMS = TEAM_NAMES.length;

export const VISION = 220;
// Teammate-call propagation radius — wider than vision so calls inform agents
// that don't see the prey themselves.
export const HEARING = 320;
export const BASE_SPEED = 2.2;
export const MIN_SIZE = 4;
export const SIZE_THRESHOLD = 1.15;
export const MASS_GAIN = 0.7;
export const PELLET_RESPAWN_TICKS = 240;
export const PELLET_VALUE = 0.7;
export const KILLCAM_MAX = 6;
// Spatial-hash cell size — tuned so VISION (220) covers ~3 cells.
export const GRID_CELL = 80;
export const TURN_RATE = 0.15; // steering inertia (0 = no turn, 1 = instant turn)

export const ADJ = [
  'Swift',
  'Brave',
  'Sneaky',
  'Wild',
  'Clever',
  'Bold',
  'Sly',
  'Fierce',
  'Cosmic',
  'Thunder',
  'Iron',
  'Storm',
  'Shadow',
  'Crystal',
  'Nimble',
];
export const NOUN = [
  'Fox',
  'Wolf',
  'Hawk',
  'Bear',
  'Tiger',
  'Owl',
  'Cobra',
  'Falcon',
  'Lynx',
  'Raven',
  'Lion',
  'Shark',
  'Eagle',
  'Panther',
  'Drake',
];
