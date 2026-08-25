/**
 * EBT Presents: Corner Store Dash — tuning + level data.
 * Every gameplay constant lives here so balance passes never touch engine code.
 */

export const GRID = { COLS: 19, ROWS: 19, TILE: 32 };

/**
 * Store layout. One glyph per tile.
 *   #  shelf / wall        .  open aisle floor
 *   *  EBT list item       P  player spawn
 *   B  bully spawn (pen)   C  checkout lane
 * Validated: every glyph is reachable from P by 4-way flood fill (tests/qa.mjs).
 */
export const MAP = [
  '###################',
  '#*.......#.......*#',
  '#.###.##.#.##.###.#',
  '#.#...............#',
  '#.#.##.##.##.##.#.#',
  '#...#...#B#...#...#',
  '#.###.#.###.#.###.#',
  '#*..#.#.....#.#..*#',
  '##.##.#.###.#.##.##',
  '#.....#..P..#.....#',
  '#.##.###.#.###.##.#',
  '#*.#.....#.....#.*#',
  '#.##.###.#.###.##.#',
  '#........#........#',
  '#.######.#.######.#',
  '#*.....#...#.....*#',
  '#.####.#.#.#.####.#',
  '#.........C.......#',
  '###################',
];

/** The EBT list — one item per aisle, read left-to-right, top-to-bottom. */
export const SHOPPING_LIST = [
  { id: 'bread', label: 'Bread', emoji: '🍞', points: 100 },
  { id: 'eggs', label: 'Eggs', emoji: '🥚', points: 100 },
  { id: 'milk', label: 'Milk', emoji: '🥛', points: 150 },
  { id: 'rice', label: 'Rice', emoji: '🍚', points: 150 },
  { id: 'beans', label: 'Beans', emoji: '🫘', points: 200 },
  { id: 'chicken', label: 'Chicken', emoji: '🍗', points: 200 },
  { id: 'greens', label: 'Greens', emoji: '🥬', points: 250 },
  { id: 'juice', label: 'Juice', emoji: '🧃', points: 250 },
];

/** Difficulty curve. Speeds are tiles-per-second. */
export const TUNING = {
  PLAYER_SPEED: 5.2,
  BULLY_SPEED_BASE: 4.0,
  /** Bully gains this much speed for every item you bag. */
  BULLY_SPEED_PER_ITEM: 0.18,
  /** Seconds the bully waits in the pen before the first chase. */
  PEN_DELAY: 2.5,
  /** Seconds of "he lost you" after a hit, so the round can restart fairly. */
  RESPAWN_GRACE: 1.6,
  /** Chance per decision that the bully picks a random turn instead of chasing. */
  SCATTER_CHANCE: 0.18,
  LIVES: 3,
  /** Round clock in seconds. Running it out ends the run. */
  TIME_LIMIT: 150,
  /** Score bonus per second left on the clock at checkout. */
  TIME_BONUS: 10,
  /** Score bonus per unused life at checkout. */
  LIFE_BONUS: 500,
};

/** Palette — corner-store neon over cold tile. Overridden by public/styles.css vars. */
export const COLORS = {
  floor: '#101318',
  shelf: '#1f6feb',
  shelfEdge: '#0b3d91',
  player: '#ffd23f',
  bully: '#ff4d4d',
  bullyScared: '#6b7280',
  item: '#f6f7f9',
  checkoutOpen: '#3fb950',
  checkoutLocked: '#484f58',
  text: '#f6f7f9',
};

/** Leaderboard API base. Same-origin by default; override for local worker dev. */
export const API_BASE = globalThis.__CSD_API_BASE__ ?? '';

export const STORAGE_KEY = 'csd.player.name';
