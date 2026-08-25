/** Store geometry: parse the glyph map once, then answer questions about it fast. */

import { GRID, MAP, SHOPPING_LIST } from './config.js';

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export class Maze {
  constructor(rows = MAP) {
    this.rows = rows;
    this.cols = GRID.COLS;
    this.rowCount = rows.length;
    this.walls = [];
    this.itemTiles = [];
    this.spawn = { x: 9, y: 9 };
    this.penSpawn = { x: 9, y: 5 };
    this.checkout = { x: 10, y: 17 };
    this.#parse();
  }

  #parse() {
    for (let y = 0; y < this.rowCount; y += 1) {
      const row = [];
      for (let x = 0; x < this.cols; x += 1) {
        const glyph = this.rows[y][x];
        row.push(glyph === '#');
        if (glyph === '*') this.itemTiles.push({ x, y });
        else if (glyph === 'P') this.spawn = { x, y };
        else if (glyph === 'B') this.penSpawn = { x, y };
        else if (glyph === 'C') this.checkout = { x, y };
      }
      this.walls.push(row);
    }
  }

  isWall(x, y) {
    if (y < 0 || y >= this.rowCount || x < 0 || x >= this.cols) return true;
    return this.walls[y][x];
  }

  isOpen(x, y) {
    return !this.isWall(x, y);
  }

  /** Directions you can leave a tile by, in a stable order. */
  exits(x, y) {
    return Object.entries(DIRS)
      .filter(([, d]) => this.isOpen(x + d.x, y + d.y))
      .map(([name, d]) => ({ name, ...d }));
  }

  /** Pair each '*' tile with its shopping-list entry, top-left reading order. */
  buildItems() {
    const tiles = [...this.itemTiles].sort((a, b) => a.y - b.y || a.x - b.x);
    return tiles.map((tile, i) => ({
      ...SHOPPING_LIST[i % SHOPPING_LIST.length],
      x: tile.x,
      y: tile.y,
      collected: false,
    }));
  }

  /**
   * Breadth-first step: the first move along a shortest path from -> to.
   * Small grid (19x19), so a full BFS per decision is cheaper than a heap.
   */
  nextStepToward(from, to) {
    const key = (x, y) => y * this.cols + x;
    const prev = new Map();
    const queue = [from];
    const seen = new Set([key(from.x, from.y)]);
    while (queue.length) {
      const cur = queue.shift();
      if (cur.x === to.x && cur.y === to.y) break;
      for (const d of this.exits(cur.x, cur.y)) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, cur);
        queue.push({ x: nx, y: ny });
      }
    }
    if (!prev.has(key(to.x, to.y)) && !(from.x === to.x && from.y === to.y)) return null;
    let node = to;
    while (prev.has(key(node.x, node.y))) {
      const parent = prev.get(key(node.x, node.y));
      if (parent.x === from.x && parent.y === from.y) {
        return { x: node.x - from.x, y: node.y - from.y };
      }
      node = parent;
    }
    return null;
  }

  /** Every open tile reachable from a start tile — used by the QA connectivity check. */
  reachableFrom(start) {
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const d of this.exits(cur.x, cur.y)) {
        const k = `${cur.x + d.x},${cur.y + d.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: cur.x + d.x, y: cur.y + d.y });
      }
    }
    return seen;
  }
}
