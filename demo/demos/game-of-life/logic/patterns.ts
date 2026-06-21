// Seed patterns + grid sizing options. `cells` is a list of [row, col] live
// cells, or 'random' for a 30%-fill seed.

export type Cells = [number, number][];
export type Pattern = { name: string; cells: Cells | 'random' };

const GLIDER: Cells = [
  [0, 1],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
];

const PULSAR: Cells = [
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 8],
  [0, 9],
  [0, 10],
  [2, 0],
  [2, 5],
  [2, 7],
  [2, 12],
  [3, 0],
  [3, 5],
  [3, 7],
  [3, 12],
  [4, 0],
  [4, 5],
  [4, 7],
  [4, 12],
  [5, 2],
  [5, 3],
  [5, 4],
  [5, 8],
  [5, 9],
  [5, 10],
  [7, 2],
  [7, 3],
  [7, 4],
  [7, 8],
  [7, 9],
  [7, 10],
  [8, 0],
  [8, 5],
  [8, 7],
  [8, 12],
  [9, 0],
  [9, 5],
  [9, 7],
  [9, 12],
  [10, 0],
  [10, 5],
  [10, 7],
  [10, 12],
  [12, 2],
  [12, 3],
  [12, 4],
  [12, 8],
  [12, 9],
  [12, 10],
];

const GOSPER: Cells = [
  [4, 0],
  [4, 1],
  [5, 0],
  [5, 1],
  [4, 10],
  [5, 10],
  [6, 10],
  [3, 11],
  [7, 11],
  [2, 12],
  [2, 13],
  [8, 12],
  [8, 13],
  [5, 14],
  [3, 15],
  [7, 15],
  [4, 16],
  [5, 16],
  [6, 16],
  [5, 17],
  [2, 20],
  [3, 20],
  [4, 20],
  [2, 21],
  [3, 21],
  [4, 21],
  [1, 22],
  [5, 22],
  [0, 24],
  [1, 24],
  [5, 24],
  [6, 24],
  [2, 34],
  [2, 35],
  [3, 34],
  [3, 35],
];

const R_PENTOMINO: Cells = [
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [2, 1],
];

export const PATTERNS: Pattern[] = [
  { name: 'Glider', cells: GLIDER },
  { name: 'Pulsar', cells: PULSAR },
  { name: 'Gosper gun', cells: GOSPER },
  { name: 'R-pentomino', cells: R_PENTOMINO },
  { name: 'Random 30%', cells: 'random' },
];

export const SIZES = [40, 60, 80, 100] as const;
export type Size = (typeof SIZES)[number];

export const CELL_PX = [3, 4, 6, 8, 12] as const;
export type CellPx = (typeof CELL_PX)[number];
